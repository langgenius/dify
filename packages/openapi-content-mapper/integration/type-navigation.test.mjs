/* oxlint-disable vitest/no-import-node-test -- Exercise native TS hover resolution against real Python exports. */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { rpcProcess } from '../test/rpc.mjs'
import navigation from '../vscode/locations.cjs'
/* oxlint-enable vitest/no-import-node-test */

const root = resolve(import.meta.dirname, '..')
const compiler = join(root, 'node_modules/typescript/bin/tsc')

test(
  'subpath type hovers navigate to Python models and handlers through aliases and re-exports',
  { timeout: 180000 },
  async (t) => {
    const dir = mkdtempSync(join(root, 'integration/.navigation-'))
    t.after(() => rmSync(dir, { recursive: true, force: true }))
    writeFileSync(
      join(dir, 'types.ts'),
      "export type { DatasetCreatePayload as Payload, PostDatasetsData as Request, PostDatasetsResponse as Response } from '@dify/openapi-content-mapper/console/datasets';",
    )
    const source = [
      "import type { Payload, Request, Response } from './types.js';",
      'export const payload: Payload = { name: "Docs" };',
      'export const request: Request = { url: "/datasets", body: payload };',
      'export function response(value: Response) { return value; }',
    ].join('\n')
    writeFileSync(join(dir, 'index.ts'), source)
    writeFileSync(
      join(dir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: { strict: true, noEmit: true, target: 'ES2022', module: 'NodeNext' },
        contentMappers: [{ package: root, extensions: ['.openapi-types'] }],
        include: ['*.ts'],
      }),
    )
    const rpc = rpcProcess(process.execPath, [compiler, '--lsp', '--stdio'], root, 120000)
    t.after(() => rpc.close())
    const uri = pathToFileURL(join(dir, 'index.ts')).href
    await rpc.request('initialize', {
      processId: process.pid,
      rootUri: pathToFileURL(dir).href,
      initializationOptions: { runExternalCode: true },
      capabilities: { textDocument: { hover: { contentFormat: ['markdown'] } } },
    })
    rpc.notify('initialized', {})
    rpc.notify('textDocument/didOpen', {
      textDocument: { uri, languageId: 'typescript', version: 1, text: source },
    })
    for (const [line, name, definition] of [
      [1, 'Payload', 'class DatasetCreatePayload(BaseModel):'],
      [
        2,
        'Request',
        'def post(self, req_data: DatasetCreatePayload, request_context: RequestContext):',
      ],
      [
        3,
        'Response',
        'def post(self, req_data: DatasetCreatePayload, request_context: RequestContext):',
      ],
    ]) {
      const hover = await rpc.request('textDocument/hover', {
        textDocument: { uri },
        position: { line, character: source.split('\n')[line].indexOf(name) },
      })
      const locations = navigation.backendLocations([hover.contents].flat())
      assert.equal(locations.length, 1, JSON.stringify(hover))
      const target = fileURLToPath(locations[0].uri)
      assert.equal(target, resolve(root, '../../api/controllers/console/datasets/datasets.py'))
      assert.equal(
        readFileSync(target, 'utf8').split('\n')[locations[0].line - 1].trim(),
        definition,
      )
    }
  },
)
