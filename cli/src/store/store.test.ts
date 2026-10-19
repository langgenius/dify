import { existsSync, readFileSync, statSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { BadYamlFormatError } from './errors'
import { YamlStore } from './store'

let dir: string
let path: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'difyctl-yaml-store-'))
  path = join(dir, 'config.yml')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function parsed<T = Record<string, unknown>>(content: string): Promise<T | null> {
  await writeFile(path, content)
  return new YamlStore(path).getTyped<T>()
}

describe('YamlStore.getTyped', () => {
  it('returns null when the file does not exist', async () => {
    expect(await new YamlStore(path).getTyped()).toBeNull()
  })

  it('reads an empty or comment-only file as an empty mapping', async () => {
    expect(await parsed('')).toEqual({})
    expect(await parsed('# empty configuration\n')).toEqual({})
  })

  it('reads nested mappings', async () => {
    expect(await parsed('name: alice\nuser:\n  id: 42\n')).toEqual({
      name: 'alice',
      user: { id: 42 },
    })
  })

  it('resolves YAML merge keys', async () => {
    const doc = await parsed('defaults: &defaults\n  format: json\nselected:\n  <<: *defaults\n')
    expect(doc?.selected).toEqual({ format: 'json' })
  })

  it('parses timestamp scalars as dates', async () => {
    const timestamp = '2026-07-10T03:04:05.000Z'
    expect((await parsed(`created_at: ${timestamp}\n`))?.created_at).toEqual(new Date(timestamp))
  })

  it('parses explicit YAML sets as JavaScript sets', async () => {
    expect((await parsed('features: !!set\n  workflow:\n  chat:\n'))?.features).toEqual(
      new Set(['workflow', 'chat']),
    )
  })

  it('rejects multiple YAML documents', async () => {
    await expect(parsed('name: alice\n---\nname: bob\n')).rejects.toThrowError(/single document/)
  })

  it('rejects duplicate mapping keys', async () => {
    await expect(parsed('name: alice\nname: bob\n')).rejects.toThrowError(/duplicated mapping key/)
  })

  it('rejects complex mapping keys', async () => {
    await expect(parsed('? [name, region]\n: deployment\n')).rejects.toThrowError(
      /does not support complex keys/,
    )
  })

  it('throws BadYamlFormatError with file path, location, and snippet for malformed YAML', async () => {
    const caught = await parsed('name: alice\nuser:\n  id: 42\n   bad: indent\n').catch(
      (err: unknown) => err,
    )
    expect(caught).toBeInstanceOf(BadYamlFormatError)
    const msg = (caught as BadYamlFormatError).message
    expect(msg).toContain(path)
    expect(msg).toMatch(/line \d+, column \d+/)
    expect(msg).toContain('bad: indent')
  })
})

describe('YamlStore.withLock concurrency', () => {
  const HOLD_MS = 200
  const releaseLater = (store: YamlStore) =>
    new Promise<void>((resolve) => setTimeout(() => void store.unlock().then(resolve), HOLD_MS))

  it('a second read waits while the first holds the lock, then reads', async () => {
    await writeFile(path, 'key: value\n')
    const s1 = new YamlStore(path)
    const s2 = new YamlStore(path)

    await s1.lock()
    const [value] = await Promise.all([s2.getTyped(), releaseLater(s1)])

    expect(value).toEqual({ key: 'value' })
  })

  it('a second write waits while the first holds the lock, then writes', async () => {
    await writeFile(path, 'key: original\n')
    const s1 = new YamlStore(path)
    const s2 = new YamlStore(path)

    await s1.lock()
    await Promise.all([s2.setTyped({ key: 'written' }), releaseLater(s1)])

    expect(await s2.getTyped()).toEqual({ key: 'written' })
  })
})

describe('YamlStore.rmIf', () => {
  it('removes the file when the predicate accepts what it holds', async () => {
    await writeFile(path, 'device_code: dc-1\n')
    await new YamlStore(path).rmIf((doc) => doc?.device_code === 'dc-1')
    expect(existsSync(path)).toBe(false)
  })

  it('keeps the file when it holds something else', async () => {
    await writeFile(path, 'device_code: dc-2\n')
    await new YamlStore(path).rmIf((doc) => doc?.device_code === 'dc-1')
    expect(readFileSync(path, 'utf8')).toBe('device_code: dc-2\n')
  })

  it('is a no-op when the file does not exist', async () => {
    await new YamlStore(path).rmIf(() => true)
    expect(existsSync(path)).toBe(false)
  })
})

describe('YamlStore persistence', () => {
  it('round-trips a nested document through disk', async () => {
    await new YamlStore(path).setTyped({ a: { b: { c: 'deep' } }, workspace: 'ws-123' })
    expect(await new YamlStore(path).getTyped()).toEqual({
      a: { b: { c: 'deep' } },
      workspace: 'ws-123',
    })
  })

  it.skipIf(process.platform === 'win32')(
    'writes the file with owner-only permissions',
    async () => {
      await new YamlStore(path).setTyped({ token: 'abc-123' })
      expect(statSync(path).mode & 0o777).toBe(0o600)
    },
  )

  it('forgets its cached content once the file is deleted and reloaded', async () => {
    await writeFile(path, 'key: value\n')

    const store = new YamlStore(path)
    expect(await store.getTyped<{ key: string }>()).toEqual({ key: 'value' })

    await rm(path)
    expect(await store.getTyped<{ key: string }>()).toBeNull()
  })

  it('flush writes file when dirty (content changed from undefined)', async () => {
    const store = new YamlStore(path)
    store.setRawContent('key: value\n')
    await store.flush()
    expect(existsSync(path)).toBe(true)
    expect(readFileSync(path, 'utf8')).toBe('key: value\n')
  })

  it('flush is a no-op when loaded content is set back unchanged', async () => {
    await writeFile(path, 'key: value\n')
    const store = new YamlStore(path)
    await store.load()
    const mtime = statSync(path).mtimeMs
    store.setRawContent('key: value\n')
    await store.flush()
    expect(statSync(path).mtimeMs).toBe(mtime)
  })
})
