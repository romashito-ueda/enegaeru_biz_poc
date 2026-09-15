import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import {
  JobViewSchema,
  type JobRequest,
  type JobScope,
  type JobView,
} from '../contracts/jobs.ts';

const ajv = new Ajv({ strict: true });
addFormats(ajv);
const isJob = ajv.compile<JobView>(JobViewSchema);
export class EngineError extends Error {
  code: string;
  retryable: boolean;
  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}
function readJob(value: unknown): JobView {
  if (!isJob(value))
    throw new EngineError(
      'INVALID_RESPONSE',
      '計算サービスの応答形式を確認できません。',
    );
  if (
    (value.state === 'succeeded') !== (value.result !== null) ||
    ['failed', 'cancelled'].includes(value.state) !== (value.error !== null) ||
    (value.result !== null && value.result.kind !== value.scope.mode) ||
    ['succeeded', 'failed', 'cancelled'].includes(value.state) !==
      (value.finishedAt !== null)
  )
    throw new EngineError('INVALID_RESPONSE', '計算状態と結果が一致しません。');
  return value;
}
export class EngineClient {
  private baseUrl: string;
  private fetcher: typeof fetch;
  constructor(baseUrl = '/engine', fetcher: typeof fetch = fetch) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.fetcher = fetcher;
  }
  private async request(
    path: string,
    init: RequestInit,
  ): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, init);
    } catch (error) {
      if (init.signal?.aborted) throw error;
      throw new EngineError(
        'SERVICE_UNAVAILABLE',
        'ローカル計算サービスに接続できません。起動状態を確認してください。',
        true,
      );
    }
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch (error) {
      if (init.signal?.aborted) throw error;
      throw new EngineError(
        'INVALID_RESPONSE',
        '計算サービスからJSONを取得できません。',
        true,
      );
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new EngineError(
        'INVALID_RESPONSE',
        '計算サービスの応答形式を確認できません。',
      );
    const data = parsed as Record<string, unknown>;
    if (!response.ok) {
      const e =
        data.error && typeof data.error === 'object'
          ? (data.error as Record<string, unknown>)
          : {};
      throw new EngineError(
        typeof e?.code === 'string' ? e.code : 'REQUEST_FAILED',
        typeof e?.message === 'string'
          ? e.message
          : '計算サービスへの要求が失敗しました。',
        e?.retryable === true,
      );
    }
    return data;
  }
  async create(request: JobRequest, signal?: AbortSignal) {
    const { validateInput } = await import('./domain/validate.ts');
    validateInput(request.input);
    const data = await this.request('/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    });
    if (typeof data.reused !== 'boolean')
      throw new EngineError('INVALID_RESPONSE', '再利用状態を取得できません。');
    return { job: readJob(data.job), reused: data.reused };
  }
  async get(id: string, signal?: AbortSignal) {
    return readJob(
      (await this.request(`/jobs/${encodeURIComponent(id)}`, { signal })).job,
    );
  }
  async cancel(id: string, signal?: AbortSignal) {
    return readJob(
      (
        await this.request(`/jobs/${encodeURIComponent(id)}/cancel`, {
          method: 'POST',
          signal,
        })
      ).job,
    );
  }
}
// The UI also compares its revision token when edits can change and return to A.
export function matchesCurrentInput(
  job: JobView,
  hash: string,
  scope: JobScope,
) {
  return (
    job.inputHash === hash &&
    job.scope.mode === scope.mode &&
    job.scope.years === scope.years &&
    JSON.stringify(job.scope.scenarioIds) === JSON.stringify(scope.scenarioIds)
  );
}
