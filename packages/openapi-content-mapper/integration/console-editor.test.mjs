/* oxlint-disable vitest/no-import-node-test -- Verify the repository editor setup through the native language server. */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { rpcProcess } from '../test/rpc.mjs'
/* oxlint-enable vitest/no-import-node-test */

const root = resolve(import.meta.dirname, '..')
const repo = resolve(root, '../..')
const web = join(repo, 'web')

test('workspace TS 7.1 resolves composed Console completions and request types from backend sources', async () => {
  const settings = JSON.parse(readFileSync(join(repo, '.vscode/settings.example.json'), 'utf8'))
  assert.equal(settings['js/ts.contentMappers.enabled'], true)
  const compiler = join(repo, settings['js/ts.tsdk.path'], 'bin/tsc')
  const directory = mkdtempSync(join(web, '.console-editor-'))
  const document = join(
    repo,
    'packages/openapi-content-mapper/examples/repository/console.openapi-source',
  )
  const source = [
    `import { api as consoleClient, query as consoleQuery } from ${JSON.stringify(document)};`,
    "const options = consoleQuery.knowledgeFs.spaces.byControlSpaceId.metadata.get.queryOptions({ input: { params: { control_space_id: 'space' } } });",
    'consoleClient.enterprise.appDeploy.accessService.',
  ].join('\n')
  writeFileSync(join(directory, 'index.ts'), source)
  writeFileSync(
    join(directory, 'tsconfig.json'),
    JSON.stringify({
      extends: '../tsconfig.json',
      contentMappers: [
        {
          package: '@dify/openapi-content-mapper',
          extensions: ['.openapi-source'],
          options: { sources: [document] },
        },
      ],
      include: ['index.ts', '../next-env.d.ts', '../global.d.ts', '../types/**/*.d.ts'],
    }),
  )
  const rpc = rpcProcess(process.execPath, [compiler, '--lsp', '--stdio'], repo, 60000)
  const uri = pathToFileURL(join(directory, 'index.ts')).href
  try {
    await rpc.request('initialize', {
      processId: process.pid,
      rootUri: pathToFileURL(repo).href,
      initializationOptions: { runExternalCode: true },
      workspaceFolders: [{ uri: pathToFileURL(repo).href, name: 'dify' }],
      capabilities: {
        general: { positionEncodings: ['utf-16'] },
        textDocument: { hover: { contentFormat: ['plaintext'] } },
      },
    })
    rpc.notify('initialized', {})
    rpc.notify('textDocument/didOpen', {
      textDocument: { uri, languageId: 'typescript', version: 1, text: source },
    })
    const completions = await rpc.request('textDocument/completion', {
      textDocument: { uri },
      position: { line: 2, character: source.split('\n')[2].length },
    })
    const labels = (completions.items ?? completions).map((item) => item.label)
    assert(labels.includes('getEnvironmentApi'), JSON.stringify(labels))
    assert(labels.includes('updateEnvironmentApi'))
    const position = { line: 1, character: source.split('\n')[1].indexOf('.get.') + 2 }
    const hover = await rpc.request('textDocument/hover', { textDocument: { uri }, position })
    assert.match(JSON.stringify(hover), /control_space_id/)
    await rpc.request('shutdown')
    rpc.notify('exit')
  } finally {
    rpc.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
