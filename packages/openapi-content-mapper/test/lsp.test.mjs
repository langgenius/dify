/* oxlint-disable vitest/no-import-node-test -- Integration tests exercise the built package in native Node, including its module hooks. */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { parseDocument } from 'yaml'
import { rpcProcess } from './rpc.mjs'
/* oxlint-enable vitest/no-import-node-test */

const root = resolve(import.meta.dirname, '..')

test('native TS 7.1 LSP: operation completions, hover, definition into YAML, live schema updates', async () => {
  const dir = mkdtempSync(join(root, 'test/.lsp-'))
  const specDocument = parseDocument(
    readFileSync(join(root, 'examples/petstore/pets.openapi.yaml'), 'utf8'),
  )
  specDocument.setIn(['paths', '/pets/{petId}', 'get', 'x-source-location'], {
    file: './backend.py',
    line: 7,
  })
  const spec = specDocument.toString()
  const source = [
    "import { api, query } from './pets.yaml';",
    '// SDK inferred by the content mapper',
    'const pet = await api.pets.byPetId.get({ params: { petId: 1 } });',
    'pet.name;',
    'query.pets.byPetId.get.queryOptions({input: {params: {petId: 1}}});',
    'api.pets.byPetId.',
  ].join('\n')
  writeFileSync(join(dir, 'pets.yaml'), spec)
  writeFileSync(join(dir, 'index.ts'), source)
  writeFileSync(
    join(dir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        module: 'NodeNext',
        target: 'ES2022',
        skipLibCheck: true,
      },
      contentMappers: [{ package: root, extensions: ['.yaml'] }],
      include: ['*.ts'],
    }),
  )
  const rpc = rpcProcess(
    process.execPath,
    [join(root, 'node_modules/typescript/bin/tsc'), '--lsp', '--stdio'],
    root,
  )
  const uri = pathToFileURL(join(dir, 'index.ts')).href
  const specUri = pathToFileURL(join(dir, 'pets.yaml')).href
  try {
    await rpc.request('initialize', {
      processId: process.pid,
      rootUri: pathToFileURL(root).href,
      initializationOptions: { runExternalCode: true },
      workspaceFolders: [{ uri: pathToFileURL(root).href, name: 'openapi-content-mapper' }],
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
      position: { line: 5, character: source.split('\n')[5].length },
    })
    const labels = (completions.items ?? completions).map((item) => item.label)
    assert(labels.includes('get'), JSON.stringify(completions))
    assert(labels.includes('delete'))
    const hover = await rpc.request('textDocument/hover', {
      textDocument: { uri },
      position: { line: 3, character: 5 },
    })
    assert.match(JSON.stringify(hover), /name.*string/)
    const methodHover = await rpc.request('textDocument/hover', {
      textDocument: { uri },
      position: { line: 2, character: source.split('\n')[2].indexOf('.get') + 2 },
    })
    assert.match(JSON.stringify(methodHover), /Open backend implementation/)
    assert.match(JSON.stringify(methodHover), /backend.py#L7/)
    const definitions = await rpc.request('textDocument/definition', {
      textDocument: { uri },
      position: { line: 2, character: source.split('\n')[2].indexOf('.get') + 2 },
    })
    assert.match(JSON.stringify(definitions), /pets.yaml/)
    const queryDefinition = await rpc.request('textDocument/definition', {
      textDocument: { uri },
      position: { line: 4, character: source.split('\n')[4].indexOf('.get') + 2 },
    })
    assert.match(JSON.stringify(queryDefinition), /pets.yaml/)
    const queryHover = await rpc.request('textDocument/hover', {
      textDocument: { uri },
      position: { line: 4, character: source.split('\n')[4].indexOf('.get') + 2 },
    })
    assert.match(JSON.stringify(queryHover), /backend.py#L7/)
    rpc.notify('textDocument/didOpen', {
      textDocument: { uri: specUri, languageId: 'yaml', version: 1, text: spec },
    })
    const changed = parseDocument(spec)
    changed.setIn(['components', 'schemas', 'Pet', 'properties', 'name', 'type'], 'number')
    rpc.notify('textDocument/didChange', {
      textDocument: { uri: specUri, version: 2 },
      contentChanges: [{ text: changed.toString() }],
    })
    const changedHover = await rpc.request('textDocument/hover', {
      textDocument: { uri },
      position: { line: 3, character: 5 },
    })
    assert.match(JSON.stringify(changedHover), /name.*number/)
    await rpc.request('shutdown')
    rpc.notify('exit')
  } finally {
    rpc.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
