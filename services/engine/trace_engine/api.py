from __future__ import annotations

from contextlib import asynccontextmanager
import json
from urllib.parse import urlparse

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .contracts import ContractError, input_hash, validate_input
from .jobs import JobManager, JobError, Limits, MESSAGES
from .worker import evaluate, WORKER_VERSION


def error(code: str, message: str, status: int, retryable=False):
    return JSONResponse({'error': {'code': code, 'message': message, 'retryable': retryable}}, status_code=status)


def validate_request(body, limits: Limits):
    if not isinstance(body, dict) or set(body) != {'input', 'scope'}:
        raise ContractError('Expected input and scope')
    scope = body['scope']
    if not isinstance(scope, dict) or set(scope) != {'mode', 'scenarioIds', 'years'}:
        raise ContractError('Invalid scope')
    if scope['mode'] not in ('validation_only', 'simulation') or scope['years'] != 20 or isinstance(scope['years'], bool):
        raise ContractError('Invalid scope mode/years')
    ids = scope['scenarioIds']
    if not isinstance(ids, list) or not 1 <= len(ids) <= limits.scenarios or any(not isinstance(s, str) for s in ids) or len(set(ids)) != len(ids):
        raise ContractError('Invalid scenario selection')
    input_data = validate_input(body['input'])
    if not set(ids) <= {s['id'] for s in input_data['scenarios']}:
        raise ContractError('Unknown scenario')
    return input_data, scope, input_hash(input_data)


def create_app(limits: Limits = Limits(), runner=evaluate, *, test_hosts=False):
    @asynccontextmanager
    async def lifespan(app):
        app.state.jobs = JobManager(limits, runner)
        # Validation uses a thread and is separately bounded from native workers.
        app.state.validating = 0
        try:
            yield
        finally:
            await run_in_threadpool(app.state.jobs.close)

    app = FastAPI(title='TRACE local engine', version=WORKER_VERSION, lifespan=lifespan)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=['localhost', '127.0.0.1'] + (['testserver'] if test_hosts else []))

    @app.middleware('http')
    async def local_origin(request: Request, call_next):
        origin = request.headers.get('origin')
        if origin:
            try:
                parsed = urlparse(origin)
            except ValueError:
                return error('ORIGIN_NOT_ALLOWED', 'Originが不正です。', 403)
            if parsed.scheme != 'http' or parsed.hostname not in ('localhost', '127.0.0.1'):
                return error('ORIGIN_NOT_ALLOWED', 'ローカル画面からの操作のみ受け付けます。', 403)
        return await call_next(request)

    @app.get('/health')
    async def health():
        return {'status': 'ok', 'workerVersion': WORKER_VERSION,
                'serviceInstanceId': app.state.jobs.instance_id, 'persistence': 'memory_only',
                'supportedModes': ['validation_only'],
                'limits': {'workers': 1, 'queued': limits.queued, 'candidatesPerJob': 1,
                           'scenariosPerJob': limits.scenarios, 'requestBytes': limits.request_bytes,
                           'runtimeSeconds': limits.runtime_seconds, 'retainedJobs': limits.retained, 'cacheSeconds': limits.cache_seconds}}

    @app.post('/jobs')
    async def submit(request: Request):
        if request.headers.get('content-type', '').split(';')[0].lower() != 'application/json':
            return error('JSON_REQUIRED', 'JSON形式で送信してください。', 415)
        if app.state.validating >= 2:
            return error('VALIDATION_BUSY', '入力を確認中です。少し待って再実行してください。', 429, True)
        app.state.validating += 1
        try:
            raw = bytearray()
            async for chunk in request.stream():
                raw.extend(chunk)
                if len(raw) > limits.request_bytes:
                    return error('INPUT_TOO_LARGE', '入力サイズの上限を超えました。', 413)
            try:
                body = json.loads(raw)
                input_data, scope, digest = await run_in_threadpool(validate_request, body, limits)
            except (ContractError, ValueError, TypeError, RecursionError, OverflowError):
                return error('INVALID_INPUT', '入力の単位・時刻・設備・計算対象を確認してください。', 422)
            if scope['mode'] == 'simulation':
                return error('ENGINE_UNAVAILABLE', '物理計算アダプターは未接続です。検証用モードのみ実行できます。', 409)
            try:
                job, reused = app.state.jobs.submit(input_data, scope, digest)
                return JSONResponse({'job': job, 'reused': reused}, status_code=200 if reused else 202)
            except JobError as e:
                return error(e.code, MESSAGES[e.code], 503 if e.code == 'SERVICE_STOPPED' else 429, True)
        finally:
            app.state.validating -= 1

    @app.get('/jobs/{job_id}')
    async def get(job_id: str):
        job = app.state.jobs.get(job_id)
        return {'job': job} if job else error('JOB_NOT_FOUND', '結果が期限切れ、またはサービスが再起動されています。再実行してください。', 404, True)

    @app.post('/jobs/{job_id}/cancel')
    async def cancel(job_id: str):
        job = app.state.jobs.cancel(job_id)
        return {'job': job} if job else error('JOB_NOT_FOUND', '対象の計算が見つかりません。', 404, True)

    return app


app = create_app()
