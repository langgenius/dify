import type { BufferStreams } from '@/sys/io/streams'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vite-plus/test'
import { Context } from '@/kernel/context'
import { io, ioService } from '@/plugins/io'
import { bufferStreams } from '@/sys/io/streams'
import { config, CONFIG_FILE_NAME } from './index'

let dir: string
let file: string
let streams: BufferStreams
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'difyctl-cfg-'))
  file = join(dir, CONFIG_FILE_NAME)
  process.env.DIFY_CONFIG_DIR = dir
  streams = bufferStreams()
})
afterEach(() => {
  delete process.env.DIFY_CONFIG_DIR
})

const load = () => new Context([[io, ioService(streams)]]).get(config)

it('returns defaults and the file path when nothing is on disk', async () => {
  const c = await load()
  expect(await c.get()).toEqual({ http: { timeout: 30_000 }, path: file })
})

it('set / get / unset round-trip through yaml', async () => {
  const c = await load()
  await c.set('http.timeout', '5000')
  expect(await c.get('http.timeout')).toBe(5000)
  await c.unset('http.timeout')
  expect(await c.get('http.timeout')).toBe(30_000)
})

it('rejects unknown keys and wrong types with exit 2, naming the file', async () => {
  const c = await load()
  await expect(c.set('nope', '1')).rejects.toMatchObject({ code: 'config_invalid_key' })
  await expect(c.set('http.timeout', 'fast')).rejects.toMatchObject({
    code: 'config_invalid_value',
    hint: expect.stringContaining(file),
  })
})

it('loads a difyctl v1 file and drops its defaults and state on the next set', async () => {
  writeFileSync(
    file,
    'schema_version: 1\ndefaults:\n  format: json\nstate:\n  current_app: app-1\nhttp:\n  timeout: 5000\n',
  )
  const c = await load()
  expect(await c.get('http.timeout')).toBe(5000)
  await c.set('http.timeout', '6000')
  expect(readFileSync(file, 'utf8')).toBe('http:\n  timeout: 6000\n')
  expect(streams.errBuf()).toBe('')
})

it('ignores unknown and future keys without a notice', async () => {
  writeFileSync(file, 'schema_version: 99\nfuture_key: x\nhttp:\n  timeout: 5000\n  later: 1\n')
  const c = await load()
  expect(await c.get()).toEqual({ http: { timeout: 5000 }, path: file })
  expect(streams.errBuf()).toBe('')
})

it('falls back to the default for an invalid value, naming the key', async () => {
  writeFileSync(file, 'http:\n  timeout: fast\n')
  const c = await load()
  expect(await c.get('http.timeout')).toBe(30_000)
  expect(streams.errBuf()).toBe(`${file}: ignoring the invalid value of http.timeout\n`)
})

it.each([
  ['not valid YAML', 'http: [unclosed\n', /is not valid YAML/],
  ['not a mapping', '- a\n- b\n', /is not a YAML mapping/],
])('reads a file that is %s as empty and replaces it on the next set', async (_l, raw, note) => {
  writeFileSync(file, raw)
  const c = await load()
  expect(await c.get('http.timeout')).toBe(30_000)
  expect(streams.errBuf()).toMatch(note)
  await c.set('http.timeout', '5000')
  expect(readFileSync(file, 'utf8')).toBe('http:\n  timeout: 5000\n')
})

it('reads the latest file, not the one it saw first', async () => {
  const c = await load()
  expect(await c.get('http.timeout')).toBe(30_000)
  writeFileSync(file, 'http:\n  timeout: 7000\n')
  expect(await c.get('http.timeout')).toBe(7000)
})

it('lets separate processes set and unset in parallel', async () => {
  const [a, b] = await Promise.all([load(), load()])
  await Promise.all([
    a.set('http.timeout', '5000'),
    b.unset('http.timeout'),
    b.set('http.timeout', '6000'),
  ])
  expect([5000, 6000, 30_000]).toContain(await a.get('http.timeout'))
  expect(readFileSync(file, 'utf8')).toMatch(/^http:\n {2}timeout: \d+\n$/)
})

it('reports a bad value once across reads and a set', async () => {
  writeFileSync(file, 'http:\n  timeout: fast\n')
  const c = await load()
  await c.get('http.timeout')
  await c.get()
  await c.set('http.timeout', '5000')
  expect(streams.errBuf()).toBe(`${file}: ignoring the invalid value of http.timeout\n`)
})
