import type { Login } from '@/plugins/session'
import type { BufferStreams } from '@/sys/io/streams'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vite-plus/test'
import { Context } from '@/kernel/context'
import { io, ioService } from '@/plugins/io'
import { session } from '@/plugins/session'
import { platform } from '@/sys'
import { bufferStreams } from '@/sys/io/streams'
import { catalog, CATALOG_DIR_NAME } from './index'

const FIXTURE = readFileSync(join(__dirname, '../../../test/fixtures/catalog.json'))
const LOGIN: Login = {
  server: 'https://d.example',
  email: 'e',
  account: { id: 'a', email: 'e', name: 'n' },
  workspaceId: null,
  tokenStorage: 'file',
  insecure: false,
}
let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'difyctl-cat-'))
  process.env.DIFY_CONFIG_DIR = dir
  process.env.DIFY_CACHE_DIR = dir
})
afterEach(() => {
  delete process.env.DIFY_CONFIG_DIR
  delete process.env.DIFY_CACHE_DIR
})

const CACHE_FILE = 'd.example.json'

async function build() {
  const ctx = new Context()
  await (await ctx.get(session)).save(LOGIN)
  return ctx.get(catalog)
}

async function buildWithStreams(): Promise<{ streams: BufferStreams; ctx: Context }> {
  const streams = bufferStreams()
  const ctx = new Context([[io, ioService(streams)]])
  await (await ctx.get(session)).save(LOGIN)
  return { streams, ctx }
}

function writeCorruptCache(): string {
  const dir_ = join(dir, CATALOG_DIR_NAME)
  mkdirSync(dir_, { recursive: true })
  const path = join(dir_, CACHE_FILE)
  writeFileSync(path, '{ not json')
  return path
}

it('knows nothing before a catalog is loaded', async () => {
  const c = await build()
  expect(c.loaded).toBe(false)
  expect(c.ops()).toEqual({})
  expect(c.op('console_app.list')).toBeUndefined()
  expect(c.fingerprint).toBe('')
})

it('replace writes the raw bytes; the fingerprint is the sha256 of those bytes', async () => {
  const c = await build()
  await c.replace(FIXTURE)
  expect(c.loaded).toBe(true)
  expect(readFileSync(join(dir, 'catalog', 'd.example.json'))).toEqual(FIXTURE)
  expect(c.fingerprint).toBe(createHash('sha256').update(FIXTURE).digest('hex'))
  const again = await build()
  expect(again.loaded).toBe(true)
  expect(again.op('console_app.workflow.run')?.kind).toBe('sse')
})

it('clear() forgets everything', async () => {
  const c = await build()
  await c.replace(FIXTURE)
  await c.clear()
  expect(c.loaded).toBe(false)
  expect(c.ops()).toEqual({})
})

it('clear() without a login rejects like path and replace do', async () => {
  const c = await new Context().get(catalog)
  await expect(c.clear()).rejects.toMatchObject({ code: 'not_logged_in' })
})

it('a cache file it cannot parse is a miss with one notice, and a refresh still works', async () => {
  const path = writeCorruptCache()
  const { streams, ctx } = await buildWithStreams()
  const c = await ctx.get(catalog)
  expect(c.loaded).toBe(false)
  expect(c.fingerprint).toBe('')
  expect(streams.errBuf().trim().split('\n')).toHaveLength(1)
  expect(streams.errBuf()).toBe(
    `ignoring unreadable catalog cache ${path}: catalog document is not valid JSON\n`,
  )

  await c.replace(FIXTURE)
  expect(c.loaded).toBe(true)
  expect(readFileSync(path)).toEqual(FIXTURE)
})

it.skipIf(platform() === 'win32')('writes the cache 0600 under a 0700 directory', async () => {
  const c = await build()
  await c.replace(FIXTURE)
  const path = join(dir, CATALOG_DIR_NAME, CACHE_FILE)
  expect(statSync(path).mode & 0o777).toBe(0o600)
  expect(statSync(join(dir, CATALOG_DIR_NAME)).mode & 0o777).toBe(0o700)
})

it('a cache it cannot write is an error naming the path', async () => {
  const c = await build()
  // A file where the catalog directory belongs: mkdir cannot make the parent.
  writeFileSync(join(dir, CATALOG_DIR_NAME), 'not a directory')
  await expect(c.replace(FIXTURE)).rejects.toMatchObject({
    code: 'unknown',
    message: `failed to write the catalog cache ${join(dir, CATALOG_DIR_NAME, CACHE_FILE)}`,
  })
  expect(c.loaded).toBe(false)
})
