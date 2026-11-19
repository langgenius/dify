/* oxlint-disable vitest/no-import-node-test, antfu/no-import-dist -- Native compiler and built SDK integration against unchanged repository documents. */
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'
import { build } from 'vite'
import { createClient } from '../dist/index.js'
import { describeOperations } from '../dist/operation.js'
import { createRouter } from '../dist/tooling/router.js'
import { transformSpec } from '../dist/tooling/transform.js'
import { openapi } from '../dist/tooling/vite.js'
import { rpcProcess } from '../test/rpc.mjs'
import '../dist/tooling/register.js'
/* oxlint-enable vitest/no-import-node-test, antfu/no-import-dist */

const root = resolve(import.meta.dirname, '..')
const specDir = process.env.DIFY_OPENAPI_DIR ?? resolve(root, '../contracts/openapi')
const names = [
  'console',
  'fastopenapi-console',
  'inner',
  'openapi',
  'service',
  'web',
  'knowledge-fs',
]
const files = names.map((name) =>
  name === 'knowledge-fs'
    ? resolve(root, '../../api/knowledge-fs-contract/knowledge-fs.openapi.json')
    : join(specDir, `${name}-openapi.json`),
)
const compiler = join(root, 'node_modules/typescript/bin/tsc')

function routes(node, path = []) {
  return [...node.methods]
    .map(([method, operation]) => ({ members: [...path, method], operation }))
    .concat([...node.children].flatMap(([key, child]) => routes(child, [...path, key])))
}

test('unchanged Dify and KnowledgeFS OpenAPI documents', { timeout: 120000 }, async (t) => {
  for (const file of files)
    assert(
      existsSync(file),
      `Missing ${file}. Supply DIFY_OPENAPI_DIR with existing generated OpenAPI files; this test never regenerates or edits them.`,
    )
  const dir = mkdtempSync(join(root, 'integration/.repository-'))
  const specs = files.map((file) => JSON.parse(readFileSync(file, 'utf8')))
  const contents = files.map((file) => readFileSync(file, 'utf8'))
  const entries = names.map((name) => join(dir, `${name}.openapi`))
  const hash = (text) => createHash('sha256').update(text).digest('hex')
  try {
    for (const [index, file] of files.entries()) symlinkSync(file, entries[index])
    writeFileSync(
      join(dir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          target: 'ES2022',
          module: 'NodeNext',
          types: ['node'],
          lib: ['ES2022', 'DOM'],
        },
        contentMappers: [{ package: root, extensions: ['.openapi'] }],
        include: ['*.ts'],
      }),
    )
    await t.test('all operations survive mapping; source hashes and counts are recorded', () => {
      specs.forEach((spec, index) => {
        const transformed = transformSpec(contents[index], entries[index])
        assert.equal(transformed.diagnostics, undefined, JSON.stringify(transformed.diagnostics))
        const operations = describeOperations(spec)
        const declared = Object.values(spec.paths).reduce(
          (count, item) =>
            count +
            Object.keys(item).filter((method) =>
              ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'].includes(
                method,
              ),
            ).length,
          0,
        )
        assert.equal(
          operations.size,
          declared,
          'No unsupported operation may be silently filtered out',
        )
        assert.equal(routes(createRouter(operations)).length, operations.size)
        t.diagnostic(
          `${names[index]}: ${Object.keys(spec.paths).length} paths, ${operations.size} operations, ${Buffer.byteLength(contents[index])} bytes, sha256 ${hash(contents[index])}`,
        )
      })
    })
    await t.test('native TS 7.1 checks every route plus real request/response assertions', () => {
      const allRoutes = specs
        .flatMap((spec, index) => [
          `import { api as api${index} } from './${names[index]}.openapi';`,
          ...routes(createRouter(describeOperations(spec))).map(({ members }, routeIndex) => {
            const expression = `api${index}${members.map((key) => `[${JSON.stringify(key)}]`).join('')}`
            return `export type Input${index}_${routeIndex} = Parameters<typeof ${expression}>; export type Output${index}_${routeIndex} = Awaited<ReturnType<typeof ${expression}>>;`
          }),
        ])
        .join('\n')
      writeFileSync(join(dir, 'all-routes.ts'), allRoutes)
      writeFileSync(
        join(dir, 'assertions.ts'),
        `
import { api as consoleApi, query as consoleQuery } from './console.openapi';
import { api as service } from './service.openapi';
import { api as web } from './web.openapi';
import { api as inner } from './inner.openapi';
import { api as openapi } from './openapi.openapi';
import { api as fast } from './fastopenapi-console.openapi';
import { api as knowledge } from './knowledge-fs.openapi';
type IsAny<T> = 0 extends (1 & T) ? true : false;
const datasets = await consoleApi.datasets.get({query: {page: 1, ids: ['id']}});
const total: number = datasets.total;
const redirect: Awaited<ReturnType<typeof consoleApi.mcp.oauth.callback.get>> = undefined;
const notAny: IsAny<typeof datasets> = false;
// @ts-expect-error actual pagination type is numeric
const wrongTotal: string = datasets.total;
// @ts-expect-error actual query limit is numeric
consoleApi.datasets.get({query: {limit: '10'}});
consoleApi.datasets.post({body: {name: 'Example'}});
// @ts-expect-error required dataset name comes from a local schema reference
consoleApi.datasets.post({body: {}});
const upload = await consoleApi.files.upload.post({body: {file: new File(['file'], 'file.txt'), source: 'datasets'}});
const fileId: string = upload.id;
// @ts-expect-error binary file accepts Blob/File, not a string
consoleApi.files.upload.post({body: {file: 'file.txt'}});
// @ts-expect-error file is required
consoleApi.files.upload.post({body: {source: 'datasets'}});
const options = consoleQuery.datasets.get.queryOptions({input: {query: {page: 1}}});
type QueryResult = Awaited<ReturnType<typeof options.queryFn>>;
const queryTotal: number = (null! as QueryResult).total;
await service.datasets.byDatasetId.document.createByFile.post({params: {dataset_id: 'id'}, body: {file: new Blob(['file'])}});
await service.datasets.byDatasetId.document.create_by_file.post({params: {dataset_id: 'id'}, body: {file: new Blob(['file'])}});
await openapi.apps.byAppId.chat.run.post({params: {app_id: 'id'}, contentType: 'multipart/form-data', body: {query: 'hello', inputs: {enabled: true}}});
await openapi.apps.byAppId.chat.run.post({params: {app_id: 'id'}, body: {query: 'hello', attachments: ['path.txt']}});
await openapi.apps.byAppId.chat.run.post({params: {app_id: 'id'}, contentType: 'multipart/form-data', body: {query: 'hello', attachments: [new File(['file'], 'file.txt')]}});
// @ts-expect-error binary values need explicit multipart selection when JSON is also available
openapi.apps.byAppId.chat.run.post({params: {app_id: 'id'}, body: {query: 'hello', attachments: [new Blob(['file'])]}});
const parameters = await web.parameters.get();
const question: string | undefined = parameters.suggested_questions?.[0];
const opaque: unknown = await inner.agentConfig.byAgentId.env.patch({params: {agent_id: 'id'}});
// @ts-expect-error an undocumented 200 body must remain unknown, not invent a shape
opaque.success;
await fast.console.api.ping.get();
const health = await knowledge.health.get();
const runtime: 'cloudflare-workers' | 'node-docker' = health.runtime;
await knowledge.uploadSessions.byId.smallFile.post({params: {id: 'id'}, query: {knowledgeSpaceId: 'space'}, body: new Blob(['bytes'])});
// @ts-expect-error raw binary upload does not accept a JSON object
knowledge.uploadSessions.byId.smallFile.post({params: {id: 'id'}, query: {knowledgeSpaceId: 'space'}, body: {file: 'x'}});
const bulk = knowledge.knowledgeSpaces.byId.documents.bulk.post({params: {id: 'id'}, body: {files: [new File(['a'], 'a.txt')]}});
type Chat = Awaited<ReturnType<typeof service.chatMessages.post>>;
const stream: Extract<Chat, ReadableStream<Uint8Array>> = new ReadableStream<Uint8Array>();
`,
      )
      const started = performance.now()
      const result = spawnSync(
        process.execPath,
        [compiler, '--runExternalCode', '--pretty', 'false', '-p', dir],
        { cwd: root, encoding: 'utf8', timeout: 90000 },
      )
      assert.ifError(result.error)
      assert.equal(result.status, 0, result.stdout + result.stderr)
      t.diagnostic(`Native compilation: ${Math.round(performance.now() - started)} ms`)
    })
    await t.test('native editor completions and hover work on the full console spec', async () => {
      const rpc = rpcProcess(process.execPath, [compiler, '--lsp', '--stdio'], root)
      try {
        await rpc.request('initialize', {
          processId: process.pid,
          rootUri: pathToFileURL(dir).href,
          capabilities: {},
          initializationOptions: { runExternalCode: true },
        })
        rpc.notify('initialized', {})
        const uri = pathToFileURL(join(dir, 'editor.ts')).href
        const text =
          "import { api } from './console.openapi';\nconst result = await api.datasets.get();\nresult.total;\napi.datasets."
        rpc.notify('textDocument/didOpen', {
          textDocument: { uri, languageId: 'typescript', version: 1, text },
        })
        const completions = await rpc.request('textDocument/completion', {
          textDocument: { uri },
          position: { line: 3, character: 13 },
        })
        const labels = (completions.items ?? completions).map((item) => item.label)
        assert(labels.includes('get') && labels.includes('post'))
        const hover = await rpc.request('textDocument/hover', {
          textDocument: { uri },
          position: { line: 2, character: 9 },
        })
        assert.match(JSON.stringify(hover), /total.*number/)
      } finally {
        rpc.close()
      }
    })
    await t.test(
      'real HTTP serialization: query, multipart, binary, relative servers and streaming',
      async () => {
        const [
          { api: consoleApi },
          ,
          ,
          { api: publicApi },
          { api: serviceApi },
          ,
          { api: knowledge },
        ] = await Promise.all(entries.map((file) => import(pathToFileURL(file).href)))
        const requests = []
        const server = createServer(async (req, res) => {
          try {
            const chunks = []
            for await (const chunk of req) chunks.push(chunk)
            const body = Buffer.concat(chunks)
            const request = new Request(`http://localhost${req.url}`, {
              method: req.method,
              headers: req.headers,
              ...(req.method !== 'GET' ? { body } : {}),
            })
            const contentType = req.headers['content-type'] ?? ''
            const data = contentType.startsWith('multipart/')
              ? await request.formData()
              : body.toString()
            requests.push({ path: req.url, headers: req.headers, data })
            if (req.url === '/v1/chat-messages') {
              res.writeHead(200, { 'Content-Type': 'text/event-stream' })
              res.write('data: {"event":"message","answer":"hello"}\n\n')
            } else {
              res.setHeader('Content-Type', 'application/json')
              res.end(
                JSON.stringify({ data: [], total: 0, id: 'uploaded', name: 'test.txt', size: 5 }),
              )
            }
          } catch (error) {
            res.writeHead(500).end(String(error))
          }
        })
        server.listen(0, '127.0.0.1')
        await once(server, 'listening')
        const origin = `http://127.0.0.1:${server.address().port}`
        const previousLocation = Object.getOwnPropertyDescriptor(globalThis, 'location')
        try {
          Object.defineProperty(globalThis, 'location', {
            configurable: true,
            value: new URL(origin),
          })
          const client = createClient({ headers: { 'Content-Type': 'application/json' } })
          await consoleApi.datasets.get({ query: { ids: ['a', 'b'], page: 2 } }, { client })
          assert.equal(requests.at(-1).path, '/console/api/datasets?ids=a&ids=b&page=2')
          await consoleApi.files.upload.post(
            { body: { file: new File(['hello'], 'test.txt'), source: 'datasets' } },
            { client },
          )
          assert.match(requests.at(-1).headers['content-type'], /^multipart\/form-data; boundary=/)
          assert.equal(requests.at(-1).data.get('file').name, 'test.txt')
          assert.equal(await requests.at(-1).data.get('file').text(), 'hello')
          assert.equal(requests.at(-1).data.get('source'), 'datasets')
          const direct = createClient({ baseUrl: origin })
          await knowledge.uploadSessions.byId.smallFile.post(
            {
              params: { id: 'a/b' },
              query: { knowledgeSpaceId: 'space' },
              body: new Blob(['binary']),
            },
            { client: direct },
          )
          assert.equal(
            requests.at(-1).path,
            '/upload-sessions/a%2Fb/small-file?knowledgeSpaceId=space',
          )
          assert.equal(requests.at(-1).headers['content-type'], 'application/octet-stream')
          assert.equal(requests.at(-1).data, 'binary')
          await knowledge.knowledgeSpaces.byId.documents.bulk.post(
            {
              params: { id: 'id' },
              body: { files: [new File(['a'], 'a.txt'), new File(['b'], 'b.txt')] },
            },
            { client: direct },
          )
          assert.deepEqual(
            requests
              .at(-1)
              .data.getAll('files')
              .map((file) => file.name),
            ['a.txt', 'b.txt'],
          )
          for (const member of ['createByFile', 'create_by_file']) {
            await serviceApi.datasets.byDatasetId.document[member].post(
              { params: { dataset_id: 'id' }, body: { file: new File(['file'], 'file.txt') } },
              { client },
            )
          }
          assert.equal(requests.at(-2).path, '/v1/datasets/id/document/create-by-file')
          assert.equal(requests.at(-1).path, '/v1/datasets/id/document/create_by_file')
          await publicApi.apps.byAppId.chat.run.post(
            {
              params: { app_id: 'id' },
              contentType: 'multipart/form-data',
              body: { query: 'hello', inputs: { enabled: true } },
            },
            { client },
          )
          assert.equal(requests.at(-1).path, '/openapi/v1/apps/id/chat:run')
          assert.equal(await requests.at(-1).data.get('query').text(), '"hello"')
          assert.equal(await requests.at(-1).data.get('inputs').text(), '{"enabled":true}')
          const stream = await serviceApi.chatMessages.post(
            { body: { query: 'hello', inputs: {}, user: 'test', response_mode: 'streaming' } },
            { client, signal: AbortSignal.timeout(3000) },
          )
          assert(stream instanceof ReadableStream)
          const reader = stream.getReader()
          assert.match(new TextDecoder().decode((await reader.read()).value), /"answer":"hello"/)
          await reader.cancel()
        } finally {
          if (previousLocation) Object.defineProperty(globalThis, 'location', previousLocation)
          else delete globalThis.location
          server.closeAllConnections()
          await new Promise((resolve) => server.close(resolve))
        }
      },
    )
    for (const [index, members, route] of [
      [0, 'datasets.get', '/datasets'],
      [6, 'health.get', '/health'],
    ]) {
      for (const namespace of ['api', 'query'])
        await t.test(
          `${names[index]} ${namespace}: full-document bundle equals one-path bundle`,
          async () => {
            async function bundle(file) {
              writeFileSync(
                join(dir, 'entry.ts'),
                `import { ${namespace} } from './${file}'; export const operation = ${namespace}.${members}${namespace === 'query' ? '.queryOptions' : ''};`,
              )
              const result = await build({
                configFile: false,
                root: dir,
                logLevel: 'silent',
                plugins: [openapi()],
                build: {
                  write: false,
                  minify: true,
                  lib: { entry: join(dir, 'entry.ts'), formats: ['es'] },
                },
              })
              return (Array.isArray(result) ? result : [result])
                .flatMap((result) => result.output)
                .filter((file) => file.type === 'chunk')
                .map((file) => file.code)
                .join('\n')
            }
            const full = await bundle(`${names[index]}.openapi`)
            const reduced = {
              ...specs[index],
              paths: { [route]: { ...specs[index].paths[route], post: undefined } },
            }
            writeFileSync(join(dir, 'reduced.openapi'), JSON.stringify(reduced))
            const small = await bundle('reduced.openapi')
            const normalize = (code) => code.replace(/^\/\/.*$/gm, '')
            assert.equal(normalize(full), normalize(small))
            for (const marker of [
              '/files/upload',
              '/upload-sessions/',
              'DatasetCreatePayload',
              'parseDocument',
              'YAMLParseError',
            ])
              assert(!full.includes(marker), `Unexpected unused content: ${marker}`)
            t.diagnostic(
              `${names[index]} ${namespace}: ${Buffer.byteLength(full)} bytes, ${gzipSync(full).length} gzip`,
            )
          },
        )
    }
  } finally {
    for (const [index, file] of files.entries())
      assert.equal(
        hash(readFileSync(file, 'utf8')),
        hash(contents[index]),
        'Source document must stay untouched',
      )
    rmSync(dir, { recursive: true, force: true })
  }
})
