"""Process entrypoint and adapter boundary. Never imported into the UI bundle."""
from __future__ import annotations

import json
from typing import Callable

WORKER_VERSION = 'trace-worker-v1'


def evaluate(input_data: dict, scope: dict, report: Callable[[float, str], None]) -> dict:
    """Validation-only adapter; real physics is connected by Issue #5 onward."""
    if scope['mode'] != 'validation_only':
        raise ValueError('Simulation adapter unavailable')
    report(0.5, 'checking_intervals')
    return {
        'kind': 'validation_only',
        'intervals': len(input_data['time']['timestamps']),
        'totalLoadKwh': sum(input_data['load']['energy']['value']),
        'scenarioIds': scope['scenarioIds'],
        'warnings': ['検証用workerです。発電量・蓄電池運転・投資効果は計算していません。'],
    }


def process_entry(send, runner, input_data: dict, scope: dict, max_result_bytes: int):
    """A new process/pipe per job lets cancellation discard native-worker state."""
    try:
        def report(fraction: float, phase: str):
            send.send(('progress', float(fraction), str(phase)))
        result = runner(input_data, scope, report)
        encoded = json.dumps(result, allow_nan=False, ensure_ascii=False)
        if len(encoded.encode('utf-8')) > max_result_bytes:
            send.send(('error', 'RESULT_TOO_LARGE'))
        else:
            send.send(('result', result))
    except Exception:
        # The API never forwards library tracebacks, native paths or input data.
        send.send(('error', 'WORKER_FAILED'))
    finally:
        send.close()
