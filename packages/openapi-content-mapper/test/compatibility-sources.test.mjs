/* oxlint-disable vitest/no-import-node-test, antfu/no-import-dist -- Exercise generated descriptors through the real command cache. */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { generateCompatibilitySources } from '../../contracts/scripts/generate-compatibility-sources.ts'
import { inspectSource, resolveDocument } from '../dist/tooling/source.js'
/* oxlint-enable vitest/no-import-node-test, antfu/no-import-dist */

test('generated Community sources refresh cached types after sibling Python dependency changes', async (t) => {
  const repo = mkdtempSync(resolve(import.meta.dirname, '.compatibility-sources-'))
  t.after(() => rmSync(repo, { recursive: true, force: true }))
  function write(path, content) {
    const file = join(repo, path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, content)
    return file
  }
  for (const file of [
    'packages/contracts/api-documents.ts',
    'packages/contracts/typescript-generation.ts',
    'packages/contracts/package.json',
    'packages/contracts/generated/api/web/types.gen.ts',
    'pnpm-lock.yaml',
    'api/schema.py',
    'api/pyproject.toml',
    'api/uv.lock',
    'dify-agent/pyproject.toml',
  ])
    write(file, file.endsWith('.json') ? '{}' : '')
  const modelPath = 'dify-agent/src/dify_agent/protocol/knowledge_fs.py'
  const model = write(modelPath, 'class KnowledgeFsCitation: pass\n')
  write(
    'packages/contracts/scripts/export-compatibility-types.ts',
    `
import { appendFileSync, readFileSync } from 'node:fs';
appendFileSync('exports.log', '1');
const source = readFileSync(${JSON.stringify(modelPath)}, 'utf8');
console.log(JSON.stringify({typescript: 'export type Source = ' + JSON.stringify(source) + ';'}));
`,
  )
  const contracts = join(repo, 'packages/contracts')
  const output = join(repo, 'packages/openapi-content-mapper/contracts')
  await generateCompatibilitySources(contracts, output)
  const file = join(output, 'web.openapi-types')
  const content = readFileSync(file, 'utf8')
  const before = inspectSource(content, file)
  assert(before.dependencies.includes(model))
  const first = resolveDocument(content, file)
  assert.deepEqual(resolveDocument(content, file), first)
  assert.equal(readFileSync(join(repo, 'exports.log'), 'utf8'), '1')
  write(modelPath, 'class KnowledgeFsCitation: extra: str\n')
  const edited = inspectSource(content, file)
  assert.notEqual(edited.identity, before.identity)
  assert.match(JSON.parse(resolveDocument(content, file).content).typescript, /extra: str/)
  assert.equal(readFileSync(join(repo, 'exports.log'), 'utf8'), '11')
  const added = write('dify-agent/src/dify_agent/protocol/new_model.py', 'class NewModel: pass\n')
  const addedIdentity = inspectSource(content, file).identity
  assert.notEqual(addedIdentity, edited.identity)
  rmSync(added)
  assert.notEqual(inspectSource(content, file).identity, addedIdentity)
  const metadata = write('dify-agent/pyproject.toml', '[project]\nversion = "2"\n')
  assert(inspectSource(content, file).dependencies.includes(metadata))
  assert.notEqual(inspectSource(content, file).identity, edited.identity)
})
