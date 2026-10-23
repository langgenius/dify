/* oxlint-disable vitest/no-import-node-test -- Compare native mapper types with the repository's generated contracts. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
/* oxlint-enable vitest/no-import-node-test */

const root = resolve(import.meta.dirname, '..')
const contracts = resolve(root, '../contracts')
const specDir = process.env.DIFY_OPENAPI_DIR ?? join(contracts, 'openapi')

test('five generated oRPC contracts match, except intentional stream and multipart differences', () => {
  const dir = mkdtempSync(join(root, 'integration/.orpc-'))
  try {
    for (const name of ['console', 'service', 'openapi'])
      symlinkSync(join(specDir, `${name}-openapi.json`), join(dir, `${name}.openapi`))
    writeFileSync(
      join(dir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          target: 'ES2022',
          module: 'NodeNext',
          allowImportingTsExtensions: true,
          types: ['node'],
          lib: ['ES2022', 'DOM'],
        },
        contentMappers: [{ package: root, extensions: ['.openapi'] }],
        include: ['*.ts'],
      }),
    )
    const checks = [
      ['listDatasets', 'consoleApi.datasets.get', 'datasets.get', [true, true], [true, true]],
      ['createDataset', 'consoleApi.datasets.post', 'datasets.post', [true, true], [true, true]],
      [
        'uploadFile',
        'consoleApi.files.upload.post',
        'files.upload.post',
        [true, true],
        [true, true],
      ],
      [
        'chatMessage',
        'serviceApi.chatMessages.post',
        'chatMessages.post',
        [true, true],
        [false, false],
      ],
      [
        'chatRun',
        'openapiApi.apps.byAppId.chat.run.post',
        'run2.post',
        [false, false],
        [true, true],
      ],
    ]
    const source = `
import { api as consoleApi } from './console.openapi';
import { api as serviceApi } from './service.openapi';
import { api as openapiApi } from './openapi.openapi';
import type { datasets } from '../../../contracts/generated/api/console/datasets/orpc.gen.ts';
import type { files } from '../../../contracts/generated/api/console/files/orpc.gen.ts';
import type { chatMessages } from '../../../contracts/generated/api/service/orpc.gen.ts';
import type { run2 } from '../../../contracts/generated/api/openapi/orpc.gen.ts';
// Read the actual procedure's Standard Schema input/output types, including Zod defaults.
// This uses the generated contract schemas, not the parallel types.gen.ts declarations.
type Schema = { '~standard': { types?: { input: unknown; output: unknown } } };
type Contract = { '~orpc': { inputSchema?: Schema; outputSchema?: Schema } };
type Input<T extends Contract> = NonNullable<NonNullable<T['~orpc']['inputSchema']>['~standard']['types']>['input'];
type Output<T extends Contract> = NonNullable<NonNullable<T['~orpc']['outputSchema']>['~standard']['types']>['output'];
type Ext<A, B> = [A] extends [B] ? true : false;
type Any<T> = 0 extends (1 & T) ? true : false;
type Unknown<T> = unknown extends T ? true : false;
${checks
  .map(
    ([name, api, contract, input, output]) => `
type ${name}NewIn = Parameters<typeof ${api}>[0];
type ${name}OldIn = Input<typeof ${contract}>;
type ${name}NewOut = Awaited<ReturnType<typeof ${api}>>;
type ${name}OldOut = Output<typeof ${contract}>;
export const ${name}Input: [Ext<${name}NewIn, ${name}OldIn>, Ext<${name}OldIn, ${name}NewIn>] = ${JSON.stringify(input)};
export const ${name}Output: [Ext<${name}NewOut, ${name}OldOut>, Ext<${name}OldOut, ${name}NewOut>] = ${JSON.stringify(output)};
export const ${name}NotAny: [Any<${name}NewIn>, Any<${name}OldIn>, Any<${name}NewOut>, Any<${name}OldOut>] = [false, false, false, false];
export const ${name}NotUnknown: [Unknown<${name}NewIn>, Unknown<${name}OldIn>, Unknown<${name}NewOut>, Unknown<${name}OldOut>] = [false, false, false, false];
`,
  )
  .join('\n')}
type NewBlocking = Exclude<chatMessageNewOut, ReadableStream<Uint8Array>>;
type OldBlocking = Exclude<chatMessageOldOut, string>;
export const blockingOutput: [Ext<NewBlocking, OldBlocking>, Ext<OldBlocking, NewBlocking>] = [true, true];
// Keep the refreshed discovery field checked explicitly, so stale exports fail this test.
type NewUpgrade = listDatasetsNewOut['data'][number]['knowledge_fs_upgrade'];
type OldUpgrade = listDatasetsOldOut['data'][number]['knowledge_fs_upgrade'];
export const upgrade: [Ext<NewUpgrade, OldUpgrade>, Ext<OldUpgrade, NewUpgrade>] = [true, true];
`
    writeFileSync(join(dir, 'check.ts'), source)
    const result = spawnSync(
      process.execPath,
      [
        join(root, 'node_modules/typescript/bin/tsc'),
        '--runExternalCode',
        '--pretty',
        'false',
        '-p',
        dir,
      ],
      { cwd: root, encoding: 'utf8', timeout: 60000 },
    )
    assert.ifError(result.error)
    assert.equal(
      result.status,
      0,
      result.stdout +
        result.stderr +
        [...result.stdout.matchAll(/check\.ts\((\d+),/g)]
          .map((match) => `\n${source.split('\n')[Number(match[1]) - 1]}`)
          .join(''),
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
