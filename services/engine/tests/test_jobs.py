import concurrent.futures
import copy
import json
import os
from pathlib import Path
import sys
import time
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
from trace_engine.api import create_app
from trace_engine.contracts import ROOT, input_hash, VALIDATORS
from trace_engine.jobs import JobError, JobManager, Limits
from trace_engine.worker import evaluate


def slow_worker(input_data, scope, report):
    report(0.1, 'slow_fixture')
    time.sleep(60)
    return evaluate(input_data, scope, report)


def block_first_worker(input_data, scope, report):
    if scope['scenarioIds'] == ['base']:
        return slow_worker(input_data, scope, report)
    return evaluate(input_data, scope, report)


def exception_worker(input_data, scope, report):
    raise RuntimeError('private implementation detail / secret fixture')


def crash_worker(input_data, scope, report):
    os._exit(23)


def invalid_worker(input_data, scope, report):
    return {'kind': 'validation_only'}


def wait_for(manager, job_id, predicate, timeout=15):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        job = manager.get(job_id)
        if job and predicate(job):
            return job
        time.sleep(0.02)
    raise AssertionError(f'Timed out waiting for {job_id}')


class JobsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.input = json.loads((ROOT / 'fixtures/generated/factory.json').read_text(encoding='utf-8'))
        cls.digest = input_hash(cls.input)
        cls.scope = {'mode': 'validation_only', 'scenarioIds': ['base'], 'years': 20}

    def manager(self, **kwargs):
        manager = JobManager(**kwargs)
        self.addCleanup(manager.close)
        return manager

    def test_dedup_queue_limit_cancel_and_retry(self):
        manager = self.manager(limits=Limits(queued=1), runner=slow_worker)
        first, reused = manager.submit(self.input, self.scope, self.digest)
        self.assertFalse(reused)
        wait_for(manager, first['id'], lambda j: j['progress']['fraction'] > 0)
        with concurrent.futures.ThreadPoolExecutor(3) as pool:
            duplicates = list(pool.map(lambda _: manager.submit(self.input, self.scope, self.digest), range(3)))
        self.assertTrue(all(reused and j['id'] == first['id'] for j, reused in duplicates))
        same, reused = manager.submit(self.input, {**self.scope, 'years': 20.0}, self.digest)
        self.assertTrue(reused)
        self.assertEqual(same['id'], first['id'])
        other_scope = {**self.scope, 'scenarioIds': ['lower-demand']}
        second, _ = manager.submit(self.input, other_scope, self.digest)
        with self.assertRaises(JobError) as error:
            manager.submit(self.input, self.scope, 'b' * 64)
        self.assertEqual(error.exception.code, 'QUEUE_FULL')
        self.assertEqual(manager.cancel(second['id'])['state'], 'cancelled')
        self.assertEqual(manager.cancel(first['id'])['state'], 'cancelled')
        retry, reused = manager.submit(self.input, self.scope, self.digest)
        self.assertNotEqual(retry['id'], first['id'])
        self.assertFalse(reused)
        wait_for(manager, retry['id'], lambda j: j['progress']['fraction'] > 0)
        self.assertIsNone(manager.get(first['id'])['result'])
        manager.cancel(retry['id'])

    def test_queued_job_keeps_the_submitted_input_and_scope(self):
        manager = self.manager(runner=block_first_worker)
        first, _ = manager.submit(self.input, self.scope, self.digest)
        wait_for(manager, first['id'], lambda j: j['progress']['fraction'] > 0)
        editing = copy.deepcopy(self.input)
        scope = {**self.scope, 'scenarioIds': ['lower-demand']}
        second, _ = manager.submit(editing, scope, self.digest)
        editing['load']['energy']['value'][0] += 500
        scope['scenarioIds'][0] = 'changed-after-submit'
        self.assertEqual(manager.get(second['id'])['scope']['scenarioIds'], ['lower-demand'])
        manager.cancel(first['id'])
        result = wait_for(manager, second['id'], lambda j: j['state'] == 'succeeded')['result']
        self.assertAlmostEqual(result['totalLoadKwh'], 1200000, delta=1e-6)
        self.assertEqual(result['scenarioIds'], ['lower-demand'])

    def test_result_size_limit_is_not_reported_as_success(self):
        manager = self.manager(limits=Limits(result_bytes=32))
        job, _ = manager.submit(self.input, self.scope, self.digest)
        failed = wait_for(manager, job['id'], lambda j: j['state'] == 'failed')
        self.assertEqual(failed['error']['code'], 'RESULT_TOO_LARGE')
        self.assertIsNone(failed['result'])

    def test_success_cache_expiry_and_scope_hash_separation(self):
        manager = self.manager(limits=Limits(cache_seconds=0.3))
        first, _ = manager.submit(self.input, self.scope, self.digest)
        success = wait_for(manager, first['id'], lambda j: j['state'] == 'succeeded')
        VALIDATORS['job'].validate(success)
        self.assertEqual(success['result']['intervals'], 17520)
        self.assertAlmostEqual(success['result']['totalLoadKwh'], 1200000, delta=1e-6)
        self.assertEqual(manager.submit(self.input, self.scope, self.digest)[0]['id'], first['id'])
        changed = copy.deepcopy(self.input)
        changed['versions']['model'] = 'different-version'
        new, _ = manager.submit(changed, self.scope, input_hash(changed))
        self.assertNotEqual(new['id'], first['id'])
        self.assertEqual(new['modelVersion'], 'different-version')
        wait_for(manager, new['id'], lambda j: j['state'] == 'succeeded')
        time.sleep(0.35)
        self.assertIsNone(manager.get(first['id']))
        self.assertNotEqual(manager.submit(self.input, self.scope, self.digest)[0]['id'], first['id'])

    def test_timeout_failure_crash_and_invalid_output_are_distinct(self):
        for runner, limit, code in [(slow_worker, 0.2, 'TIME_LIMIT'), (exception_worker, 10, 'WORKER_FAILED'), (crash_worker, 10, 'WORKER_EXITED'), (invalid_worker, 10, 'WORKER_OUTPUT_INVALID')]:
            with self.subTest(code=code):
                manager = self.manager(limits=Limits(runtime_seconds=limit), runner=runner)
                job, _ = manager.submit(self.input, self.scope, self.digest)
                failed = wait_for(manager, job['id'], lambda j: j['state'] == 'failed')
                self.assertEqual(failed['error']['code'], code)
                self.assertIsNone(failed['result'])
                self.assertNotIn('private implementation', json.dumps(failed))
                manager.close()

    def test_shutdown_and_restart_are_visible(self):
        manager = self.manager(runner=slow_worker)
        job, _ = manager.submit(self.input, self.scope, self.digest)
        wait_for(manager, job['id'], lambda j: j['progress']['fraction'] > 0)
        manager.close()
        self.assertEqual(manager.get(job['id'])['error']['code'], 'SERVICE_STOPPED')
        with self.assertRaises(JobError):
            manager.submit(self.input, self.scope, self.digest)
        restarted = self.manager()
        self.assertNotEqual(manager.instance_id, restarted.instance_id)
        self.assertIsNone(restarted.get(job['id']))

    def test_retention_and_cancelled_pending_queue_stay_bounded(self):
        manager = self.manager(limits=Limits(retained=3), runner=slow_worker)
        first, _ = manager.submit(self.input, self.scope, self.digest)
        wait_for(manager, first['id'], lambda j: j['progress']['fraction'] > 0)
        ids = []
        for i in range(12):
            job, _ = manager.submit(self.input, self.scope, str(i).zfill(64))
            ids.append(job['id'])
            manager.cancel(job['id'])
        self.assertLessEqual(sum(manager.get(i) is not None for i in ids), 2)
        self.assertEqual(len(manager._pending), 0)
        manager.cancel(first['id'])

    def test_http_remains_responsive_during_worker_and_validates_requests(self):
        app = create_app(runner=slow_worker, test_hosts=True)
        with TestClient(app) as client:
            response = client.post('/jobs', json={'input': self.input, 'scope': self.scope})
            self.assertEqual(response.status_code, 202)
            job_id = response.json()['job']['id']
            wait_for(app.state.jobs, job_id, lambda j: j['progress']['fraction'] > 0)
            started = time.monotonic()
            self.assertEqual(client.get('/health').status_code, 200)
            self.assertLess(time.monotonic() - started, 1)
            self.assertEqual(client.get(f'/jobs/{job_id}').json()['job']['state'], 'running')
            duplicate = client.post('/jobs', json={'input': self.input, 'scope': self.scope})
            self.assertEqual(duplicate.status_code, 200)
            self.assertTrue(duplicate.json()['reused'])
            self.assertEqual(client.post(f'/jobs/{job_id}/cancel').json()['job']['state'], 'cancelled')
            self.assertEqual(client.get('/jobs/missing').status_code, 404)
            self.assertEqual(client.post('/jobs', content='bad').status_code, 415)
            self.assertEqual(client.post('/jobs', content='{', headers={'content-type': 'application/json'}).status_code, 422)
            invalid = copy.deepcopy(self.input)
            invalid['load']['energy']['unit'] = 'kW'
            self.assertEqual(client.post('/jobs', json={'input': invalid, 'scope': self.scope}).status_code, 422)
            self.assertEqual(client.post('/jobs', json={'input': self.input, 'scope': {**self.scope, 'scenarioIds': ['missing']}}).status_code, 422)
            unavailable = client.post('/jobs', json={'input': self.input, 'scope': {**self.scope, 'mode': 'simulation'}})
            self.assertEqual(unavailable.json()['error']['code'], 'ENGINE_UNAVAILABLE')
            self.assertEqual(client.get('/health', headers={'origin': 'https://untrusted.invalid'}).status_code, 403)
            self.assertEqual(client.get('/health', headers={'host': 'untrusted.invalid'}).status_code, 400)
        with TestClient(create_app(test_hosts=True)) as restarted:
            self.assertEqual(restarted.get(f'/jobs/{job_id}').status_code, 404)

    def test_body_limit(self):
        with TestClient(create_app(limits=Limits(request_bytes=32), test_hosts=True)) as client:
            self.assertEqual(client.post('/jobs', content='x' * 33, headers={'content-type': 'application/json'}).status_code, 413)

    def test_native_packages_are_installed_in_service_environment(self):
        import importlib.metadata
        import PySAM.Pvwattsv8 as pv
        import numpy_financial as npf
        self.assertEqual(importlib.metadata.version('nlr-pysam'), '8.0.0')
        model = pv.default('PVWattsNone')
        self.assertGreater(model.SystemDesign.system_capacity, 0)
        self.assertAlmostEqual(float(npf.npv(0.1, [-100, 60, 60])), 4.132231404958674)


if __name__ == '__main__':
    unittest.main()
