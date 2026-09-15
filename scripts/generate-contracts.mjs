import { mkdir, readFile, writeFile } from 'node:fs/promises';
import {
  SimulationInputSchema,
  SimulationResultSchema,
} from '../contracts/schema.ts';
import { JobViewSchema, ValidationResultSchema } from '../contracts/jobs.ts';
const directory = new URL('../contracts/generated/', import.meta.url);
await mkdir(directory, { recursive: true });
for (const [name, schema] of Object.entries({
  input: SimulationInputSchema,
  result: SimulationResultSchema,
  job: JobViewSchema,
  validationResult: ValidationResultSchema,
})) {
  const path = new URL(`${name}.schema.json`, directory);
  const content = `${JSON.stringify(
    {
      $schema: 'http://json-schema.org/draft-07/schema#',
      $id: `https://trace.local/contracts/${name}/1.0.0`,
      ...schema,
    },
    null,
    2,
  )}\n`;
  if (process.argv.includes('--check')) {
    if ((await readFile(path, 'utf8')) !== content)
      throw new Error(
        `Stale contract: ${name}. Run npm run contracts:generate.`,
      );
  } else await writeFile(path, content);
}
