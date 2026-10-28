/* oxlint-disable vitest/no-import-node-test -- Verify actual package exports with the native compiler and language server. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { rpcProcess } from './rpc.mjs'
/* oxlint-enable vitest/no-import-node-test */

const root = resolve(import.meta.dirname, '..')
const compiler = join(root, 'node_modules/typescript/bin/tsc')

for (const moduleResolution of ['NodeNext', 'Bundler']) {
  test(`contract subpaths have typed LSP diagnostics without paths overrides (${moduleResolution})`, async (t) => {
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
            options: {
              sources: [join(root, 'contracts/enterprise-app-deploy.openapi-types')],
            },
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
