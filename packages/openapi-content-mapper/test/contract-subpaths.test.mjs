/* oxlint-disable vitest/no-import-node-test -- Verify actual package exports with the native compiler and language server. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { rpcProcess } from './rpc.mjs'
/* oxlint-enable vitest/no-import-node-test */

const root = resolve(import.meta.dirname, '..')
const compiler = join(root, 'node_modules/typescript/bin/tsc')

for (const moduleResolution of ['NodeNext', 'Bundler']) {
  test(`contract subpaths have typed LSP diagnostics without paths or sources options (${moduleResolution})`, async (t) => {
    const dir = mkdtempSync(join(root, 'test/.subpaths-'))
    t.after(() => rmSync(dir, { recursive: true, force: true }))
    const source = [
      "import type { EnvironmentDeployment, RuntimeState } from '@dify/openapi-content-mapper/enterprise-app-deploy';",
      'export function environmentId(deployment: EnvironmentDeployment): string {',
      '  return deployment.environment.id;',
      '}',
      'export type RuntimeStates = typeof RuntimeState;',
      "export const state: RuntimeState = 'RUNTIME_STATE_RUNNING';",
    ].join('\n')
    writeFileSync(join(dir, 'index.ts'), source)
    writeFileSync(
      join(dir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          target: 'ES2022',
          module: moduleResolution === 'Bundler' ? 'ESNext' : 'NodeNext',
          moduleResolution,
        },
        contentMappers: [
          {
            package: root,
            extensions: ['.openapi-types'],
          },
        ],
        include: ['index.ts'],
      }),
    )
    const compiled = spawnSync(process.execPath, [compiler, '--runExternalCode', '-p', dir], {
      encoding: 'utf8',
      timeout: 30000,
    })
    assert.ifError(compiled.error)
    assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr)

    const rpc = rpcProcess(process.execPath, [compiler, '--lsp', '--stdio'], root)
    const uri = pathToFileURL(join(dir, 'index.ts')).href
    try {
      await rpc.request('initialize', {
        processId: process.pid,
        rootUri: pathToFileURL(dir).href,
        initializationOptions: { runExternalCode: true },
        workspaceFolders: [{ uri: pathToFileURL(dir).href, name: 'subpath-consumer' }],
        capabilities: {
          general: { positionEncodings: ['utf-16'] },
          textDocument: {
            diagnostic: { dynamicRegistration: false },
            hover: { contentFormat: ['plaintext'] },
          },
        },
      })
      rpc.notify('initialized', {})
      rpc.notify('textDocument/didOpen', {
        textDocument: { uri, languageId: 'typescript', version: 1, text: source },
      })
      const diagnostics = await rpc.request('textDocument/diagnostic', {
        textDocument: { uri },
      })
      // CLI type checking alone misses TS7016 when the server reports it as a hint.
      assert.deepEqual(diagnostics.items, [], JSON.stringify(diagnostics))
      const hover = await rpc.request('textDocument/hover', {
        textDocument: { uri },
        position: { line: 0, character: source.indexOf('EnvironmentDeployment') },
      })
      assert.match(JSON.stringify(hover), /environment: DeploymentEnvironment/)

      rpc.notify('textDocument/didChange', {
        textDocument: { uri, version: 2 },
        contentChanges: [
          {
            text: `${source}\nexport const invalid: EnvironmentDeployment = { environment: 123 };`,
          },
        ],
      })
      const invalid = await rpc.request('textDocument/diagnostic', {
        textDocument: { uri },
      })
      assert(invalid.items.some((item) => item.code === 2322 && item.severity === 1))
      assert(!invalid.items.some((item) => item.code === 7016))
    } finally {
      rpc.close()
    }
  })
}

test('automatically registered package sources refresh LSP and incremental types after input changes', async (t) => {
  const dir = mkdtempSync(join(root, 'test/.bundled-sources-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const mapper = join(dir, 'mapper')
  const contracts = join(mapper, 'contracts')
  mkdirSync(contracts, { recursive: true })
  cpSync(join(root, 'dist'), join(mapper, 'dist'), { recursive: true })
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  writeFileSync(
    join(mapper, 'package.json'),
    JSON.stringify({ name: 'fixture-mapper', type: 'module', typescript: manifest.typescript }),
  )
  const schema = join(mapper, 'schema.txt')
  writeFileSync(schema, 'string')
  writeFileSync(
    join(mapper, 'export.mjs'),
    `import {readFileSync} from 'node:fs';
process.stdout.write(JSON.stringify({typescript: 'export type Model = {name: ' + readFileSync('schema.txt', 'utf8') + '};'}));`,
  )
  writeFileSync(
    join(contracts, 'shared.json'),
    JSON.stringify({
      cwd: '..',
      command: ['node', 'export.mjs'],
      inputs: ['schema.txt', 'export.mjs'],
    }),
  )
  writeFileSync(
    join(contracts, 'model.openapi-types'),
    JSON.stringify({ extends: './shared.json' }),
  )
  writeFileSync(join(contracts, 'model.d.ts'), "export type * from './model.openapi-types';")
  const source = [
    "import type {Model} from './mapper/contracts/model.d.ts';",
    'export function name(model: Model): string { return model.name; }',
  ].join('\n')
  writeFileSync(join(dir, 'index.ts'), source)
  writeFileSync(
    join(dir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: { strict: true, noEmit: true, incremental: true, module: 'NodeNext' },
      contentMappers: [{ package: mapper, extensions: ['.openapi-types'] }],
      include: ['index.ts'],
    }),
  )
  const compile = () =>
    spawnSync(process.execPath, [compiler, '--runExternalCode', '-p', dir], {
      encoding: 'utf8',
      timeout: 30000,
    })
  const first = compile()
  assert.ifError(first.error)
  assert.equal(first.status, 0, first.stdout + first.stderr)

  const rpc = rpcProcess(process.execPath, [compiler, '--lsp', '--stdio'], root)
  try {
    await rpc.request('initialize', {
      processId: process.pid,
      rootUri: pathToFileURL(dir).href,
      initializationOptions: { runExternalCode: true },
      capabilities: {
        general: { positionEncodings: ['utf-16'] },
        textDocument: {
          diagnostic: { dynamicRegistration: false },
          hover: { contentFormat: ['plaintext'] },
        },
      },
    })
    rpc.notify('initialized', {})
    const uri = pathToFileURL(join(dir, 'index.ts')).href
    rpc.notify('textDocument/didOpen', {
      textDocument: { uri, languageId: 'typescript', version: 1, text: source },
    })
    const hover = () =>
      rpc.request('textDocument/hover', {
        textDocument: { uri },
        position: { line: 0, character: source.indexOf('Model') },
      })
    assert.match(JSON.stringify(await hover()), /name: string/)
    writeFileSync(schema, 'number')
    rpc.notify('workspace/didChangeWatchedFiles', {
      changes: [{ uri: pathToFileURL(schema).href, type: 2 }],
    })
    assert.match(JSON.stringify(await hover()), /name: number/)
    const diagnostics = await rpc.request('textDocument/diagnostic', { textDocument: { uri } })
    assert(diagnostics.items.some((item) => item.code === 2322))
    const changed = compile()
    assert.ifError(changed.error)
    assert.notEqual(changed.status, 0)
    assert.match(changed.stdout + changed.stderr, /number.*string/)
  } finally {
    rpc.close()
  }
})
