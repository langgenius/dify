import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BadYamlFormatError, ConcurrentAccessError } from './errors'
import { YamlStore } from './store'

describe('YamlStore.doGet', () => {
  it('returns default when content is undefined', () => {
    const store = new YamlStore('/irrelevant')
    expect(store.doGet({ key: 'name', default: 'fallback' })).toBe('fallback')
  })

  it('reads a flat key', () => {
    const store = new YamlStore('/irrelevant')
    store.setRawContent('name: alice\n')
    expect(store.doGet({ key: 'name', default: '' })).toBe('alice')
  })

  it('reads a nested key via dot notation', () => {
    const store = new YamlStore('/irrelevant')
    store.setRawContent('user:\n  id: 42\n')
    expect(store.doGet({ key: 'user.id', default: 0 })).toBe(42)
  })

  it('returns default for a missing flat key', () => {
    const store = new YamlStore('/irrelevant')
    store.setRawContent('name: alice\n')
    expect(store.doGet({ key: 'age', default: -1 })).toBe(-1)
  })

  it('returns default when an intermediate path segment is absent', () => {
    const store = new YamlStore('/irrelevant')
    store.setRawContent('user:\n  name: bob\n')
    expect(store.doGet({ key: 'user.address.city', default: 'unknown' })).toBe('unknown')
  })

  it('returns default when an intermediate path segment is a scalar', () => {
    const store = new YamlStore('/irrelevant')
    store.setRawContent('user: scalar\n')
    expect(store.doGet({ key: 'user.id', default: 0 })).toBe(0)
  })

  it('throws BadYamlFormatError with file path, location, and snippet for malformed YAML', () => {
    const path = '/irrelevant'
    const store = new YamlStore(path)
    store.setRawContent('name: alice\nuser:\n  id: 42\n   bad: indent\n')
    let caught: unknown
    try {
      store.doGet({ key: 'name', default: '' })
    }
    catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(BadYamlFormatError)
    const msg = (caught as BadYamlFormatError).message
    expect(msg).toContain(path)
    expect(msg).toMatch(/line \d+, column \d+/)
    expect(msg).toContain('bad: indent')
  })
})

describe('YamlStore.doSet', () => {
  it('sets a flat key from empty content', () => {
    const store = new YamlStore('/irrelevant')
    store.doSet({ key: 'name', default: '' }, 'alice')
    expect(store.doGet({ key: 'name', default: '' })).toBe('alice')
  })

  it('sets a nested key, creating intermediate objects', () => {
    const store = new YamlStore('/irrelevant')
    store.doSet({ key: 'user.id', default: 0 }, 42)
    expect(store.doGet({ key: 'user.id', default: 0 })).toBe(42)
  })

  it('overwrites an existing key without disturbing siblings', () => {
    const store = new YamlStore('/irrelevant')
    store.setRawContent('name: alice\nage: 30\n')
    store.doSet({ key: 'name', default: '' }, 'bob')
    expect(store.doGet({ key: 'name', default: '' })).toBe('bob')
    expect(store.doGet({ key: 'age', default: 0 })).toBe(30)
  })

  it('replaces a scalar intermediate with an object when path deepens', () => {
    const store = new YamlStore('/irrelevant')
    store.setRawContent('user: scalar\n')
    store.doSet({ key: 'user.id', default: 0 }, 99)
    expect(store.doGet({ key: 'user.id', default: 0 })).toBe(99)
  })
})

describe('FileBasedStore.withLock concurrency', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'difyctl-yaml-store-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('second get throws while first holds the lock, succeeds after release', async () => {
    const path = join(dir, 'config.yml')
    await writeFile(path, 'key: value\n')

    const s1 = new YamlStore(path)
    const s2 = new YamlStore(path)

    s1.lock()

    expect(() => s2.get({ key: 'key', default: '' })).toThrow(ConcurrentAccessError)

    s1.unlock()

    expect(s2.get({ key: 'key', default: '' })).toBe('value')
  })

  it('second set throws while first holds the lock, succeeds after release', async () => {
    const path = join(dir, 'config.yml')
    await writeFile(path, 'key: original\n')

    const s1 = new YamlStore(path)
    const s2 = new YamlStore(path)

    s1.lock()

    expect(() => s2.set({ key: 'key', default: '' }, 'blocked')).toThrow(ConcurrentAccessError)

    s1.unlock()

    s2.set({ key: 'key', default: '' }, 'written')
    expect(s2.get({ key: 'key', default: '' })).toBe('written')
  })
})

describe('YamlStore persistence', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'difyctl-yaml-store-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('round-trips a flat value through disk', async () => {
    const path = join(dir, 'config.yml')
    await writeFile(path, '')

    const s1 = new YamlStore(path)
    s1.setRawContent('')
    s1.doSet({ key: 'workspace', default: '' }, 'ws-123')
    writeFileSync(path, s1.getRawContent() ?? '')

    const s2 = new YamlStore(path)
    s2.setRawContent(readFileSync(path, 'utf8'))
    expect(s2.doGet({ key: 'workspace', default: '' })).toBe('ws-123')
  })

  it('round-trips a deep nested value through disk', async () => {
    const path = join(dir, 'config.yml')
    await writeFile(path, '')

    const s1 = new YamlStore(path)
    s1.setRawContent('')
    s1.doSet({ key: 'a.b.c', default: '' }, 'deep')
    writeFileSync(path, s1.getRawContent() ?? '')

    const s2 = new YamlStore(path)
    s2.setRawContent(readFileSync(path, 'utf8'))
    expect(s2.doGet({ key: 'a.b.c', default: '' })).toBe('deep')
  })

  it('second doSet on a reloaded store does not clobber the first key', async () => {
    const path = join(dir, 'config.yml')
    await writeFile(path, '')

    const s1 = new YamlStore(path)
    s1.setRawContent('')
    s1.doSet({ key: 'x', default: '' }, 'first')
    writeFileSync(path, s1.getRawContent() ?? '')

    const s2 = new YamlStore(path)
    s2.setRawContent(readFileSync(path, 'utf8'))
    s2.doSet({ key: 'y', default: '' }, 'second')
    writeFileSync(path, s2.getRawContent() ?? '')

    const s3 = new YamlStore(path)
    s3.setRawContent(readFileSync(path, 'utf8'))
    expect(s3.doGet({ key: 'x', default: '' })).toBe('first')
    expect(s3.doGet({ key: 'y', default: '' })).toBe('second')
  })

  it('load → doSet → flush writes the value to disk', async () => {
    const path = join(dir, 'config.yml')
    await writeFile(path, 'existing: value\n')

    const store = new YamlStore(path)
    store.load()
    store.doSet({ key: 'token', default: '' }, 'abc-123')
    store.flush()

    const raw = readFileSync(path, 'utf8')
    const store2 = new YamlStore(path)
    store2.setRawContent(raw)
    expect(store2.doGet({ key: 'token', default: '' })).toBe('abc-123')
    expect(store2.doGet({ key: 'existing', default: '' })).toBe('value')
  })

  it('flush writes file when dirty (content changed from undefined)', () => {
    const path = join(dir, 'config.yml')
    const store = new YamlStore(path)
    store.setRawContent('key: value\n')
    store.flush()
    expect(existsSync(path)).toBe(true)
    expect(readFileSync(path, 'utf8')).toBe('key: value\n')
  })

  it('flush is a no-op when loaded content is set back unchanged', async () => {
    const path = join(dir, 'config.yml')
    await writeFile(path, 'key: value\n')
    const store = new YamlStore(path)
    store.load()
    const mtime = statSync(path).mtimeMs
    store.setRawContent('key: value\n')
    store.flush()
    expect(statSync(path).mtimeMs).toBe(mtime)
  })
})
