import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { EngineClient, matchesCurrentInput } from '../lib/engine-client.ts';

test('aborting a response body keeps cancellation distinct from malformed JSON', async () => {
  const controller = new AbortController();
  const client = new EngineClient('/engine', async () => ({
    ok: true,
    json: async () => {
      controller.abort();
      throw new DOMException('Aborted', 'AbortError');
    },
  }));
  await assert.rejects(client.get('a'.repeat(32), controller.signal), {
    name: 'AbortError',
  });
});

const input = JSON.parse(
  readFileSync(
    new URL('../fixtures/generated/factory.json', import.meta.url),
    'utf8',
  ),
);
const job = {
  id: 'a'.repeat(32),
  serviceInstanceId: 'b'.repeat(32),
  state: 'queued',
  inputHash: 'c'.repeat(64),
  workerVersion: 'trace-worker-v1',
  modelVersion: 'contract-only-v1',
  scope: { mode: 'validation_only', scenarioIds: ['base'], years: 20 },
  progress: { fraction: 0, phase: 'queued' },
  createdAt: '2026-09-15T00:00:00Z',
  finishedAt: null,
  result: null,
  error: null,
};
test('engine client sends typed jobs through the dev proxy and handles reused results', async () => {
  let calls = [];
  const client = new EngineClient('/engine', async (url, options) => {
    calls.push([url, options]);
    return Response.json({ job, reused: false }, { status: 202 });
  });
  assert.equal(
    (await client.create({ input, scope: job.scope })).job.state,
    'queued',
  );
  assert.equal(calls[0][0], '/engine/jobs');
  assert.equal(JSON.parse(calls[0][1].body).input.schemaVersion, '1.0.0');
  assert.equal((await client.get(job.id)).id, job.id);
  await client.cancel(job.id);
  assert.equal(calls[2][0], `/engine/jobs/${job.id}/cancel`);
  assert.equal(calls[2][1].method, 'POST');
  assert.ok(matchesCurrentInput(job, job.inputHash, job.scope));
  assert.ok(!matchesCurrentInput(job, 'd'.repeat(64), job.scope));
  assert.ok(
    !matchesCurrentInput(job, job.inputHash, {
      ...job.scope,
      scenarioIds: ['lower-demand'],
    }),
  );
  assert.ok(
    !matchesCurrentInput(job, job.inputHash, {
      ...job.scope,
      mode: 'simulation',
    }),
  );
});
test('engine client distinguishes API errors, network outages and malformed successes', async () => {
  const failed = new EngineClient('/engine', async () =>
    Response.json(
      {
        error: {
          code: 'QUEUE_FULL',
          message: '計算待ちの上限',
          retryable: true,
        },
      },
      { status: 429 },
    ),
  );
  await assert.rejects(
    failed.get(job.id),
    (e) => e.code === 'QUEUE_FULL' && e.retryable,
  );
  const offline = new EngineClient('/engine', async () => {
    throw new TypeError('fetch failed');
  });
  await assert.rejects(
    offline.get(job.id),
    (e) => e.code === 'SERVICE_UNAVAILABLE',
  );
  const invalid = new EngineClient('/engine', async () =>
    Response.json({ job: { ...job, state: 'succeeded' } }),
  );
  await assert.rejects(
    invalid.get(job.id),
    (e) => e.code === 'INVALID_RESPONSE',
  );
});
