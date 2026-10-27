/* oxlint-disable vitest/no-import-node-test, antfu/no-import-dist -- Exercise command sources through the real compiler and adapters. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { build, createServer } from 'vite'
import loader from '../dist/tooling/loader.js'
import { inspectSource, resolveDocument } from '../dist/tooling/source.js'
import { openapi } from '../dist/tooling/vite.js'
import { rpcProcess } from './rpc.mjs'
/* oxlint-enable vitest/no-import-node-test, antfu/no-import-dist */

const root = resolve(import.meta.dirname, '..')
const compiler = join(root, 'node_modules/typescript/bin/tsc')

function fixture(t) {
  const directory = mkdtempSync(join(root, 'test/.source-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  mkdirSync(join(directory, 'unwatched'))
  const file = join(directory, 'pets.openapi-source')
  const schema = join(directory, 'schema.txt')
  writeFileSync(schema, 'string')
  writeFileSync(
    join(directory, 'export.mjs'),
    `
import { readFileSync, appendFileSync } from 'node:fs';
appendFileSync('unwatched/calls', '1');
console.error('Exporter diagnostic');
console.log(JSON.stringify({openapi:'3.1.0',info:{title:'Pets',version:'1'},paths:{
  '/pets':{get:{'x-source-location':{file:'./backend.py',line:7},responses:{200:{description:'OK',content:{'application/json':{schema:{type:readFileSync('schema.txt','utf8')}}}}}}},
  '/unused':{get:{responses:{204:{description:'OK'}}}}
}}));
`,
  )
  const content = JSON.stringify({
    command: ['node', 'export.mjs'],
    inputs: ['export.mjs', '*.txt'],
  })
  writeFileSync(file, content)
  const config = {
    compilerOptions: {
      strict: true,
      noEmit: true,
      incremental: true,
      skipLibCheck: true,
      target: 'ES2022',
      module: 'NodeNext',
    },
    contentMappers: [
      {
        package: root,
        extensions: ['.openapi-source'],
        options: { sources: ['./pets.openapi-source'] },
      },
    ],
    include: ['*.ts'],
  }
  writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify(config))
  return { directory, file, content, schema, config }
}

test('command sources stay in memory, cache by backend inputs, and do not cache failed exports', (t) => {
  const { directory, file, content, schema } = fixture(t)
  const before = inspectSource(content, file)
  const first = resolveDocument(content, file)
  assert.equal(
    JSON.parse(first.content).paths['/pets'].get.responses[200].content['application/json'].schema
      .type,
    'string',
  )
  assert(first.dependencies.includes(schema))
  writeFileSync(join(directory, 'unrelated.log'), 'Not an exporter input')
  assert.equal(inspectSource(content, file).identity, before.identity)
  assert.deepEqual(resolveDocument(content, file), first)
  assert.equal(readFileSync(join(directory, 'unwatched/calls'), 'utf8'), '1')
  writeFileSync(schema, 'number')
  assert.notEqual(inspectSource(content, file).identity, before.identity)
  assert.notEqual(resolveDocument(content, file).content, first.content)
  const identity = inspectSource(content, file).identity
  writeFileSync(join(directory, 'new.txt'), 'new source')
  assert.notEqual(inspectSource(content, file).identity, identity)
  writeFileSync(join(directory, 'export.mjs'), "console.error('export failed');process.exit(1);")
  assert.throws(() => resolveDocument(content, file), /export failed/)
  writeFileSync(join(directory, 'export.mjs'), "console.log('not JSON');")
  assert.throws(() => resolveDocument(content, file), /JSON/)
  writeFileSync(join(directory, 'export.mjs'), `console.log(${JSON.stringify(first.content)});`)
  assert.equal(resolveDocument(content, file).content.trim(), first.content.trim())
})

test('excluded inputs do not invalidate contracts; optional inputs track creation, edits and removal', (t) => {
  const { directory, file } = fixture(t)
  mkdirSync(join(directory, 'tests'))
  const ignored = join(directory, 'tests/schema.txt')
  writeFileSync(ignored, 'unrelated')
  const content = JSON.stringify({
    command: ['node', 'export.mjs'],
    inputs: ['**/*.txt', 'export.mjs'],
    exclude: ['tests/**'],
    optionalInputs: ['.env'],
  })
  const first = inspectSource(content, file)
  assert(!first.dependencies.includes(ignored))
  writeFileSync(ignored, 'another test')
  assert.equal(inspectSource(content, file).identity, first.identity)
  const env = join(directory, '.env')
  assert(first.dependencies.includes(env))
  writeFileSync(env, 'SETTING=one')
  const created = inspectSource(content, file)
  assert.notEqual(created.identity, first.identity)
  writeFileSync(env, 'SETTING=two')
  assert.notEqual(inspectSource(content, file).identity, created.identity)
  rmSync(env)
  assert.equal(inspectSource(content, file).identity, first.identity)
})

test('TS incremental checks invalidate when backend input changes without touching the descriptor', (t) => {
  const { directory, schema, config } = fixture(t)
  writeFileSync(
    join(directory, 'index.ts'),
    "import { api } from './pets.openapi-source'; const result: string = await api.pets.get();",
  )
  const compile = () =>
    spawnSync(process.execPath, [compiler, '--runExternalCode', '-p', directory], {
      encoding: 'utf8',
    })
  const first = compile()
  assert.equal(first.status, 0, first.stdout + first.stderr)
  writeFileSync(schema, 'number')
  const changed = compile()
  assert.notEqual(changed.status, 0)
  assert.match(changed.stdout + changed.stderr, /number.*string/)
  config.contentMappers[0].options.sources = []
  writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify(config))
  const untracked = compile()
  assert.notEqual(untracked.status, 0)
  assert.match(untracked.stdout + untracked.stderr, /options.sources/)
})

test('Node, Vite and the Next loader consume the same command source and track its inputs', async (t) => {
  const { directory, file, schema } = fixture(t)
  const consumer = join(directory, 'consumer.mjs')
  writeFileSync(
    consumer,
    "import { api } from './pets.openapi-source'; export const load = api.pets.get;",
  )
  const node = spawnSync(
    process.execPath,
    [
      '--import',
      join(root, 'dist/tooling/register.js'),
      '--input-type=module',
      '-e',
      `
import { load } from ${JSON.stringify(pathToFileURL(consumer).href)};
globalThis.fetch = async () => new Response(JSON.stringify('pet'), {headers:{'content-type':'application/json'}});
if (await load(undefined, {client: (await import('@dify/openapi-content-mapper')).createClient({baseUrl:'https://example.com'})}) !== 'pet') throw new Error('Wrong response');
`,
    ],
    { cwd: root, encoding: 'utf8' },
  )
  assert.equal(node.status, 0, node.stderr)
  const bundled = await build({
    configFile: false,
    root: directory,
    logLevel: 'silent',
    plugins: [openapi()],
    build: { write: false, lib: { entry: consumer, formats: ['es'] }, minify: false },
  })
  const code = (Array.isArray(bundled) ? bundled : [bundled])
    .flatMap((output) => output.output)
    .filter((item) => item.type === 'chunk')
    .map((item) => item.code)
    .join('\n')
  assert(code.includes('/pets'))
  assert(!code.includes('/unused'))
  assert(!code.includes('export.mjs'))
  const dependencies = new Set()
  const run = () =>
    new Promise((resolve, reject) =>
      loader.call({
        resourcePath: join(root, 'dist/tooling/openapi-namespace.js'),
        resourceQuery: `?${new URLSearchParams({ 'openapi-document': file, 'openapi-router': '[]' })}`,
        getOptions: () => ({}),
        getResolve: () => async () => {
          throw new Error('Unexpected resolution')
        },
        addDependency: (file) => dependencies.add(file),
        async: () => (error, code) => (error ? reject(error) : resolve(code)),
      }),
    )
  const before = await run()
  assert(before.includes('pets'))
  assert(dependencies.has(schema))
  const exporter = join(directory, 'export.mjs')
  writeFileSync(exporter, readFileSync(exporter, 'utf8').replace("'/pets'", "'/animals'"))
  const after = await run()
  assert(after.includes('animals'))
  assert(!after.includes('"pets"'))
})

test('Vite refreshes command sources when a new backend input is added', async (t) => {
  const { directory, file, content } = fixture(t)
  writeFileSync(file, JSON.stringify({ ...JSON.parse(content), optionalInputs: ['.env'] }))
  const exporter = join(directory, 'export.mjs')
  writeFileSync(
    exporter,
    readFileSync(exporter, 'utf8')
      .replace('readFileSync, appendFileSync', 'readFileSync, appendFileSync, existsSync')
      .replace("'/pets':", "[existsSync('extra.txt') ? '/animals' : '/pets']:"),
  )
  writeFileSync(join(directory, 'entry.ts'), "export { api } from './pets.openapi-source'")
  const server = await createServer({
    configFile: false,
    root: directory,
    logLevel: 'silent',
    plugins: [openapi()],
    server: { port: 0 },
  })
  t.after(() => server.close())
  // A new file created during Chokidar's initial scan is not an `add` event
  // when ignoreInitial is enabled (notably on Linux).
  const watcherReady = new Promise((resolve) => server.watcher.once('ready', resolve))
  await server.listen()
  await watcherReady
  await server.transformRequest('/entry.ts')
  await server.transformRequest('/pets.openapi-source')
  const url = '/pets.openapi-source?openapi-router=%5B%5D'
  assert.match((await server.transformRequest(url)).code, /pets/)
  const extra = join(directory, 'extra.txt')
  const refreshed = new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('No Vite reload after adding a backend input')),
      10000,
    )
    const send = server.ws.send.bind(server.ws)
    server.ws.send = (...args) => {
      if (args[0]?.type === 'full-reload' && args[0].triggeredBy === extra) {
        clearTimeout(timeout)
        resolve()
      }
      return send(...args)
    }
  })
  writeFileSync(extra, 'new backend route')
  await refreshed
  assert.match((await server.transformRequest(url)).code, /animals/)
})

test('the language server refreshes command-source hover types after backend changes', async (t) => {
  const { directory, schema } = fixture(t)
  const source =
    "import { api } from './pets.openapi-source';\nconst pet = await api.pets.get();\npet;"
  writeFileSync(join(directory, 'index.ts'), source)
  const rpc = rpcProcess(process.execPath, [compiler, '--lsp', '--stdio'], root)
  t.after(() => rpc.close())
  const uri = pathToFileURL(join(directory, 'index.ts')).href
  await rpc.request('initialize', {
    processId: process.pid,
    rootUri: pathToFileURL(directory).href,
    initializationOptions: { runExternalCode: true },
    capabilities: {
      general: { positionEncodings: ['utf-16'] },
      textDocument: { hover: { contentFormat: ['plaintext'] } },
    },
  })
  rpc.notify('initialized', {})
  rpc.notify('textDocument/didOpen', {
    textDocument: { uri, languageId: 'typescript', version: 1, text: source },
  })
  const hover = () =>
    rpc.request('textDocument/hover', {
      textDocument: { uri },
      position: { line: 2, character: 1 },
    })
  assert.match(JSON.stringify(await hover()), /pet: string/)
  const methodHover = await rpc.request('textDocument/hover', {
    textDocument: { uri },
    position: { line: 1, character: source.split('\n')[1].indexOf('.get') + 2 },
  })
  assert.match(JSON.stringify(methodHover), /Open backend implementation/)
  assert.match(JSON.stringify(methodHover), /backend.py#L7/)
  writeFileSync(schema, 'number')
  rpc.notify('workspace/didChangeWatchedFiles', {
    changes: [{ uri: pathToFileURL(schema).href, type: 2 }],
  })
  assert.match(JSON.stringify(await hover()), /pet: number/)
  await rpc.request('shutdown')
  rpc.notify('exit')
})
