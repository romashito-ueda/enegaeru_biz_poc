from __future__ import annotations

from collections import deque
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timezone
import json
import math
import multiprocessing as mp
import threading
import time
from uuid import uuid4

from .worker import evaluate, process_entry, WORKER_VERSION
from .contracts import VALIDATORS, input_hash as hash_input

TERMINAL = {'succeeded', 'failed', 'cancelled'}
MESSAGES = {
    'QUEUE_FULL': '計算待ちが上限に達しました。少し待って再実行してください。',
    'SERVICE_STOPPED': '計算サービスが停止しました。再起動後に再実行してください。',
    'TIME_LIMIT': '計算時間の上限に達しました。対象を減らして再実行してください。',
    'WORKER_EXITED': '計算プロセスが異常終了しました。再実行してください。',
    'WORKER_FAILED': '計算に失敗しました。入力を確認して再実行してください。',
    'WORKER_OUTPUT_INVALID': '計算結果の形式を検証できませんでした。',
    'RESULT_TOO_LARGE': '計算結果のサイズが上限を超えました。',
    'CANCELLED': '計算をキャンセルしました。',
}


@dataclass(frozen=True)
class Limits:
    queued: int = 4
    retained: int = 20
    request_bytes: int = 4 * 1024 * 1024
    result_bytes: int = 8 * 1024 * 1024
    scenarios: int = 3
    runtime_seconds: float = 300
    cache_seconds: float = 900


class JobError(Exception):
    def __init__(self, code: str):
        self.code = code
        super().__init__(MESSAGES[code])


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class JobManager:
    """One supervisor thread, one spawn process at a time, bounded in-memory state."""
    def __init__(self, limits: Limits = Limits(), runner=evaluate):
        self.limits, self.runner = limits, runner
        self.instance_id = uuid4().hex
        self._jobs, self._cache, self._pending = {}, {}, deque()
        self._lock = threading.RLock()
        self._wake, self._stop = threading.Event(), threading.Event()
        self._context = mp.get_context('spawn')
        self._thread = threading.Thread(target=self._loop, name='trace-job-supervisor', daemon=True)
        self._thread.start()

    def _prune(self):
        clock = time.monotonic()
        for job_id, job in list(self._jobs.items()):
            if job['state'] in TERMINAL and clock - job['_finished'] >= self.limits.cache_seconds:
                self._forget(job_id)

    def _forget(self, job_id):
        job = self._jobs.pop(job_id)
        if job_id in self._pending:
            self._pending.remove(job_id)
        if self._cache.get(job['_key']) == job_id:
            self._cache.pop(job['_key'], None)

    def submit(self, input_data: dict, scope: dict, input_hash: str) -> tuple[dict, bool]:
        key = hash_input({'workerVersion': WORKER_VERSION, 'inputHash': input_hash, 'scope': scope})
        with self._lock:
            if self._stop.is_set():
                raise JobError('SERVICE_STOPPED')
            self._prune()
            existing = self._cache.get(key)
            if existing:
                return self._public(self._jobs[existing]), True
            queued = sum(j['state'] == 'queued' for j in self._jobs.values())
            if queued >= self.limits.queued:
                raise JobError('QUEUE_FULL')
            while len(self._jobs) >= self.limits.retained:
                oldest = next((jid for jid, j in self._jobs.items() if j['state'] in TERMINAL), None)
                if oldest is None:
                    raise JobError('QUEUE_FULL')
                self._forget(oldest)
            job_id = uuid4().hex
            # Later edits must never mutate a queued job after its hash is fixed.
            snapshot_input, snapshot_scope = deepcopy(input_data), deepcopy(scope)
            self._jobs[job_id] = {
                'id': job_id, 'serviceInstanceId': self.instance_id, 'state': 'queued',
                'inputHash': input_hash, 'workerVersion': WORKER_VERSION,
                'modelVersion': snapshot_input['versions']['model'], 'scope': snapshot_scope,
                'progress': {'fraction': 0, 'phase': 'queued'},
                'createdAt': now_iso(), 'finishedAt': None, 'result': None, 'error': None,
                '_input': snapshot_input, '_key': key, '_finished': 0,
            }
            self._pending.append(job_id)
            self._cache[key] = job_id
            snapshot = self._public(self._jobs[job_id])
            self._wake.set()
            return snapshot, False

    def _public(self, job):
        # Return a detached snapshot, never exposing the input or mutable internals.
        return json.loads(json.dumps({k: v for k, v in job.items() if not k.startswith('_')}, allow_nan=False))

    def get(self, job_id: str):
        with self._lock:
            self._prune()
            job = self._jobs.get(job_id)
            return self._public(job) if job else None

    def _finish(self, job, state: str, *, result=None, code=None):
        if job['state'] in TERMINAL:
            return
        job.update(state=state, finishedAt=now_iso(), result=result, _finished=time.monotonic(), _input=None)
        if code:
            job['error'] = {'code': code, 'message': MESSAGES[code], 'retryable': code != 'CANCELLED'}
        if state == 'succeeded':
            job['progress'] = {'fraction': 1, 'phase': 'completed'}
        else:
            job['progress'] = {**job['progress'], 'phase': state}
            if self._cache.get(job['_key']) == job['id']:
                self._cache.pop(job['_key'], None)
            if job['id'] in self._pending:
                self._pending.remove(job['id'])

    def cancel(self, job_id: str):
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return None
            self._finish(job, 'cancelled', code='CANCELLED')
            self._wake.set()
            return self._public(job)

    def close(self):
        with self._lock:
            self._stop.set()
            for job in self._jobs.values():
                self._finish(job, 'cancelled', code='SERVICE_STOPPED')
            self._wake.set()
        self._thread.join(timeout=4)

    def _loop(self):
        while not self._stop.is_set():
            job = None
            with self._lock:
                self._prune()
                while self._pending:
                    candidate = self._jobs.get(self._pending.popleft())
                    if candidate and candidate['state'] == 'queued':
                        job = candidate
                        job['state'] = 'running'
                        job['progress'] = {'fraction': 0, 'phase': 'starting'}
                        break
            if job is None:
                self._wake.wait(0.05)
                self._wake.clear()
            else:
                self._run(job)

    def _run(self, job):
        receive, send = self._context.Pipe(duplex=False)
        process = self._context.Process(target=process_entry, args=(send, self.runner, job['_input'], job['scope'], self.limits.result_bytes), daemon=True)
        started = time.monotonic()
        try:
            process.start()
            send.close()
            while True:
                with self._lock:
                    if job['state'] in TERMINAL:
                        break
                    if time.monotonic() - started >= self.limits.runtime_seconds:
                        self._finish(job, 'failed', code='TIME_LIMIT')
                        break
                if receive.poll(0.02):
                    try:
                        message = receive.recv()
                    except EOFError:
                        with self._lock:
                            self._finish(job, 'failed', code='WORKER_EXITED')
                        break
                    with self._lock:
                        if job['state'] in TERMINAL:
                            break
                        if message[0] == 'progress':
                            fraction = message[1]
                            if not math.isfinite(fraction) or not 0 <= fraction <= 1 or not 1 <= len(message[2]) <= 80:
                                self._finish(job, 'failed', code='WORKER_OUTPUT_INVALID')
                                break
                            job['progress'] = {'fraction': max(job['progress']['fraction'], fraction), 'phase': message[2]}
                        elif message[0] == 'result':
                            result = message[1]
                            if not VALIDATORS['validationResult'].is_valid(result) or result['scenarioIds'] != job['scope']['scenarioIds']:
                                self._finish(job, 'failed', code='WORKER_OUTPUT_INVALID')
                            else:
                                self._finish(job, 'succeeded', result=result)
                            break
                        else:
                            code = message[1] if message[1] in MESSAGES else 'WORKER_FAILED'
                            self._finish(job, 'failed', code=code)
                            break
                elif not process.is_alive():
                    with self._lock:
                        self._finish(job, 'failed', code='WORKER_EXITED')
                    break
        except Exception:
            with self._lock:
                self._finish(job, 'failed', code='WORKER_FAILED')
        finally:
            if process.pid is not None:
                if process.is_alive():
                    process.terminate()
                process.join(timeout=1)
                if process.is_alive():
                    process.kill()
                    process.join(timeout=1)
                if not process.is_alive():
                    process.close()
            receive.close()
            send.close()
