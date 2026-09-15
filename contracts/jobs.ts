import { Type, type Static } from '@sinclair/typebox';
import type { SimulationInput } from './schema.ts';
const states = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
] as const;

export const JobScopeSchema = Type.Object(
  {
    mode: Type.Union([
      Type.Literal('validation_only'),
      Type.Literal('simulation'),
    ]),
    scenarioIds: Type.Array(Type.String({ minLength: 1 }), {
      minItems: 1,
      maxItems: 3,
      uniqueItems: true,
    }),
    years: Type.Literal(20),
  },
  { additionalProperties: false },
);
export const ValidationResultSchema = Type.Object(
  {
    kind: Type.Literal('validation_only'),
    intervals: Type.Literal(17520),
    totalLoadKwh: Type.Number({ minimum: 0 }),
    scenarioIds: Type.Array(Type.String({ minLength: 1 }), {
      minItems: 1,
      maxItems: 3,
      uniqueItems: true,
    }),
    warnings: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  },
  { additionalProperties: false },
);
export const JobViewSchema = Type.Object(
  {
    id: Type.String({ pattern: '^[a-f0-9]{32}$' }),
    serviceInstanceId: Type.String({ pattern: '^[a-f0-9]{32}$' }),
    state: Type.Union(states.map((v) => Type.Literal(v))),
    inputHash: Type.String({ pattern: '^[a-f0-9]{64}$' }),
    workerVersion: Type.String({ minLength: 1 }),
    modelVersion: Type.String({ minLength: 1 }),
    scope: JobScopeSchema,
    progress: Type.Object(
      {
        fraction: Type.Number({ minimum: 0, maximum: 1 }),
        phase: Type.String({ minLength: 1, maxLength: 80 }),
      },
      { additionalProperties: false },
    ),
    createdAt: Type.String({ format: 'date-time' }),
    finishedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    result: Type.Union([ValidationResultSchema, Type.Null()]),
    error: Type.Union([
      Type.Object(
        {
          code: Type.String({ minLength: 1 }),
          message: Type.String({ minLength: 1 }),
          retryable: Type.Boolean(),
        },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
);
export type JobScope = Static<typeof JobScopeSchema>;
export type JobView = Static<typeof JobViewSchema>;
export type JobRequest = { input: SimulationInput; scope: JobScope };
