/* oxlint-disable vitest/no-import-node-test -- Audit the opt-in exports with the native compiler and actual contracts. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, globSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import {
  exportCompatibilityTypes,
  loadCommunityDocuments,
  renderCompatibilityTypes,
  selectCommunityDocument,
} from '../../contracts/scripts/export-compatibility-types.ts'
/* oxlint-enable vitest/no-import-node-test */

const root = resolve(import.meta.dirname, '..')
const contracts = resolve(root, '../contracts')
const compiler = join(root, 'node_modules/typescript/bin/tsc')

test('all published contracts names and types remain compatible, including snapshot-only enterprise exports', async (t) => {
  const dir = mkdtempSync(join(root, 'integration/.contracts-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const modules = globSync('generated/**/types.gen.ts', { cwd: contracts }).sort()
  const documents = { ...loadCommunityDocuments(false), ...loadCommunityDocuments(true) }
  let types = 0
  let values = 0
  for (const [index, file] of modules.entries()) {
    const module = file.slice('generated/'.length, -'/types.gen.ts'.length)
    const previous = readFileSync(join(contracts, file), 'utf8')
    const document = module.startsWith('api/')
      ? selectCommunityDocument(module, documents)
      : undefined
    const current = document
      ? await renderCompatibilityTypes(document)
      : await exportCompatibilityTypes(module)
    writeFileSync(join(dir, `module${index}.ts`), current)
    const checks = [
      `import type * as Old from ${JSON.stringify(join(contracts, file).replace(/\.ts$/, '.js'))};`,
      `import type * as Current from './module${index}.js';`,
      'type Assert<T extends true> = T;',
      'type Assignable<A, B> = [A] extends [B] ? true : false;',
      'type IsAny<T> = 0 extends (1 & T) ? true : false;',
    ]
    for (const [, name] of previous.matchAll(/^export type (\w+)\s*=/gm)) {
      types++
      checks.push(
        `type OldToNew${name} = Assert<Assignable<Old.${name}, Current.${name}>>;`,
        `type NewToOld${name} = Assert<Assignable<Current.${name}, Old.${name}>>;`,
        `type NoAny${name} = Assert<Assignable<IsAny<Current.${name}>, IsAny<Old.${name}>>>;`,
      )
    }
    for (const [, name] of previous.matchAll(/^export const (\w+)\s*=/gm)) {
      values++
      checks.push(
        `type OldValue${name} = Assert<Assignable<typeof Old.${name}, typeof Current.${name}>>;`,
        `type NewValue${name} = Assert<Assignable<typeof Current.${name}, typeof Old.${name}>>;`,
      )
    }
    writeFileSync(join(dir, `check${index}.ts`), checks.join('\n'))
  }
  writeFileSync(
    join(dir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        target: 'ES2022',
        module: 'NodeNext',
        lib: ['ES2022', 'DOM'],
      },
      include: ['*.ts'],
    }),
  )
  const result = spawnSync(process.execPath, [compiler, '-p', dir, '--pretty', 'false'], {
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 8 * 1024 * 1024,
  })
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert(!existsSync(join(contracts, '.compatibility-output')))
  t.diagnostic(
    `Checked ${modules.length} modules, ${types} named types and ${values} runtime enum objects in both directions`,
  )
})

test('mapper subpaths expose the existing types without conditions or changing legacy runtime imports', (t) => {
  const dir = mkdtempSync(join(root, 'integration/.subpaths-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  for (const mapper of [false, true]) {
    const path = mapper
      ? '@dify/openapi-content-mapper/console/datasets'
      : '@dify/contracts/api/console/datasets/types.gen'
    writeFileSync(
      join(dir, 'index.ts'),
      `
import type {DatasetCreatePayload, PostDatasetsData, PostDatasetsErrors, PostDatasetsResponses, PostDatasetsError, PostDatasetsResponse} from '${path}';
import type {AccessMode} from '${mapper ? '@dify/openapi-content-mapper/enterprise' : '@dify/contracts/enterprise/types.gen'}';
import {AccessMode as AccessModes} from '@dify/contracts/enterprise/types.gen';
const body: DatasetCreatePayload = {name: 'Docs'};
const request: PostDatasetsData = {url: '/datasets', body};
const response: PostDatasetsResponse = null! as PostDatasetsResponses[201];
const error: PostDatasetsError = null! as PostDatasetsErrors[409];
const mode: AccessMode = AccessModes.ACCESS_MODE_PRIVATE;
// @ts-expect-error legacy requests still require the URL
const bad: PostDatasetsData = {body};
// @ts-expect-error status maps must not become any
const wrong: PostDatasetsResponses[201] = 'wrong';
`,
    )
    writeFileSync(
      join(dir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          target: 'ES2022',
          module: 'NodeNext',
        },
        contentMappers: mapper
          ? [
              {
                package: root,
                extensions: ['.openapi-types'],
              },
            ]
          : [],
        include: ['index.ts'],
      }),
    )
    const result = spawnSync(
      process.execPath,
      [compiler, '--runExternalCode', '--traceResolution', '-p', dir],
      {
        encoding: 'utf8',
        timeout: 180000,
        maxBuffer: 16 * 1024 * 1024,
      },
    )
    assert.ifError(result.error)
    assert.equal(result.status, 0, (result.stdout + result.stderr).slice(-12000))
    assert.match(
      result.stdout,
      mapper
        ? /contracts\/console\/datasets\.openapi-types/
        : /generated\/api\/console\/datasets\/types\.gen\.ts/,
    )
  }
  const runtime = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
import assert from 'node:assert/strict';
import {AccessMode} from '@dify/contracts/enterprise/types.gen';
assert.equal(AccessMode.ACCESS_MODE_PRIVATE, 'ACCESS_MODE_PRIVATE');
assert(import.meta.resolve('@dify/contracts/enterprise/types.gen').endsWith('/generated/enterprise/types.gen.ts'));
await assert.rejects(import('@dify/openapi-content-mapper/console/datasets'), {code: 'ERR_PACKAGE_PATH_NOT_EXPORTED'});
`,
    ],
    { cwd: root, encoding: 'utf8' },
  )
  assert.equal(runtime.status, 0, runtime.stdout + runtime.stderr)
})
