import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import * as path from 'node:path'
// oxlint-disable-next-line vitest/no-import-node-test -- Exercise the installed dependency patch independently of Vite.
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

const require = createRequire(new URL('../../web/package.json', import.meta.url))
const source = fs.readFileSync(require.resolve('@vitejs/devtools-rolldown'), 'utf8')
function loadReader() {
  return runInNewContext(
    `${source.slice(source.indexOf('//#region src/node/utils/format.ts'), source.indexOf('//#region src/node/rolldown/logs-manager.ts'))}; ({ Reader: RolldownEventsReader, Manager: RolldownEventsManager, getInitialChunkIds, pruneReaders })`,
    { fs, fs$1: fs.promises, ...path, Buffer, parseToEvent: JSON.parse },
  )
}

test('evicts an oversized idle session without clearing a live RPC reference', () => {
  const { Reader, pruneReaders } = loadReader()
  const previous = Reader.get('/previous/logs.json')
  previous.logBytes = 5 * 1024 ** 3
  previous.manager.modules.set('keep', { id: 'keep' })
  const current = Reader.get('/current/logs.json')
  current.logBytes = 5 * 1024 ** 3
  pruneReaders(current)
  assert.equal(Reader.peek('/previous/logs.json'), undefined)
  assert.equal(Reader.peek('/current/logs.json'), current)
  assert.equal(previous.manager.modules.get('keep').id, 'keep')
})

test('keeps pending readers and evicts them after completion when needed', () => {
  const { Reader, pruneReaders } = loadReader()
  const pending = Reader.get('/pending/logs.json')
  pending.logBytes = 5 * 1024 ** 3
  pending.pendingRead = Promise.resolve()
  const current = Reader.get('/current/logs.json')
  pruneReaders(current)
  assert.equal(Reader.peek('/pending/logs.json'), pending)
  pending.pendingRead = undefined
  pruneReaders(current)
  assert.equal(Reader.peek('/pending/logs.json'), undefined)
})

test('retains small sessions in LRU order within the byte and count budgets', () => {
  const { Reader } = loadReader()
  const first = Reader.get('/0/logs.json')
  for (let i = 1; i < 32; i++) Reader.get(`/${i}/logs.json`)
  Reader.get('/0/logs.json')
  Reader.get('/32/logs.json')
  assert.equal(Reader.peek('/0/logs.json'), first)
  assert.equal(Reader.peek('/1/logs.json'), undefined)
})

test('initial chunks exclude dynamic subtrees, including restored old caches', () => {
  const { Manager, getInitialChunkIds } = loadReader()
  const chunks = [
    {
      chunk_id: 0,
      is_user_defined_entry: true,
      is_initial: true,
      imports: [
        { chunk_id: 1, kind: 'import-statement' },
        { chunk_id: 2, kind: 'dynamic-import' },
      ],
    },
    { chunk_id: 1, is_initial: true, imports: [{ chunk_id: 0, kind: 'import-statement' }] },
    { chunk_id: 2, is_initial: true, imports: [{ chunk_id: 3, kind: 'import-statement' }] },
    { chunk_id: 3, is_initial: true, imports: [] },
  ]
  assert.deepEqual([...getInitialChunkIds(chunks)], [0, 1])
  const manager = new Manager()
  const snapshot = manager.snapshot()
  snapshot.chunks = chunks.map((chunk) => [chunk.chunk_id, chunk])
  manager.restore(snapshot)
  assert.deepEqual(
    [...manager.chunks.values()].filter((chunk) => chunk.is_initial).map((chunk) => chunk.chunk_id),
    [0, 1],
  )
})

test('plugin metrics hydrate in bounded batches and preserve filtering and ordering', async () => {
  const { Reader } = loadReader()
  const reader = Reader.get('/mock/batched-plugin/logs.json')
  const entries = Array.from({ length: 513 }, (_, i) => [
    String(i),
    {
      start: { offset: i * 2, length: i === 256 ? 2 * 1024 * 1024 : 10 },
      end: { offset: i * 2 + 1, length: 10 },
    },
  ])
  reader.moduleEventIndex = new Map([
    ['test.ts', { resolveIds: new Map(), loads: new Map(entries), transforms: new Map() }],
  ])
  let batches = 0
  reader.readEventsAt = async (locations) => {
    batches++
    assert.ok(locations.length <= 256)
    if (locations.some((location) => location.length > 1024 * 1024))
      assert.equal(locations.length, 2)
    return locations.map(({ offset }) => ({
      action: offset % 2 ? 'HookLoadCallEnd' : 'HookLoadCallStart',
      plugin_id: Math.floor(offset / 2) % 2,
      plugin_name: 'test',
      timestamp: 2000 - offset,
      content: null,
    }))
  }
  const metrics = await reader.hydratePluginBuildMetricsFromIndex(1)
  assert.equal(metrics.calls.length, 256)
  assert.equal(metrics.calls[0].id, '511')
  assert.equal(metrics.calls.at(-1).id, '1')
  assert.ok(batches > 4)
  reader.dispose()
})

test('metadata readers retain their oversized session and disposal preserves replacements', () => {
  const { Reader } = loadReader()
  const log = Reader.get('/session/logs.json')
  log.logBytes = 5 * 1024 ** 3
  Reader.get('/session/meta.json')
  assert.equal(Reader.peek('/session/logs.json'), log)
  Reader.get('/other/logs.json')
  assert.equal(Reader.peek('/session/logs.json'), undefined)
  const replacement = Reader.get('/session/logs.json')
  log.dispose()
  assert.equal(Reader.peek('/session/logs.json'), replacement)
})
