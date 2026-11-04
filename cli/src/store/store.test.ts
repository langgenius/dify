import { existsSync, readFileSync, statSync } from 'node:fs'
import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { BadYamlFormatError } from './errors'
import { loadYaml, REMOVE, YamlStore } from './store'

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
  return loadYaml(await new YamlStore(path).read(), path) as T | null
}

describe('loadYaml', () => {
  it('returns null when the file does not exist', async () => {
    expect(loadYaml(await new YamlStore(path).read(), path)).toBeNull()
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

describe('YamlStore lock', () => {
  const HOLD_MS = 200
  // Holds the lock the way another difyctl process would, then lets it go.
  async function holdLock(beforeRelease: () => Promise<void> = async () => {}): Promise<void> {
    await writeFile(`${path}.lock`, '')
    setTimeout(() => void beforeRelease().then(() => unlink(`${path}.lock`)), HOLD_MS)
  }

  it('a read waits while another process holds the lock', async () => {
    await writeFile(path, 'key: value\n')
    await holdLock()
    const started = Date.now()
    expect(await new YamlStore(path).read()).toBe('key: value\n')
    expect(Date.now() - started).toBeGreaterThanOrEqual(HOLD_MS / 2)
  })

  it('an update waits while another process holds the lock, then sees its write', async () => {
    await writeFile(path, 'key: original\n')
    await holdLock(() => writeFile(path, 'key: theirs\n'))
    let seen: string | undefined
    await new YamlStore(path).update((content) => {
      seen = content
      return { key: 'mine' }
    })
    expect(seen).toBe('key: theirs\n')
    expect(readFileSync(path, 'utf8')).toBe('key: mine\n')
  })

  it('parallel updates from separate stores all land', async () => {
    const WRITERS = 8
    await Promise.all(
      Array.from({ length: WRITERS }, (_, n) =>
        new YamlStore(path).update((content) => ({
          ...loadYaml(content, path),
          [`k${n}`]: n,
        })),
      ),
    )
    expect(Object.keys(loadYaml(await new YamlStore(path).read(), path) ?? {})).toHaveLength(
      WRITERS,
    )
  })
})

describe('YamlStore.update', () => {
  it('round-trips a nested document through disk', async () => {
    await new YamlStore(path).update(() => ({ a: { b: { c: 'deep' } }, workspace: 'ws-123' }))
    expect(loadYaml(await new YamlStore(path).read(), path)).toEqual({
      a: { b: { c: 'deep' } },
      workspace: 'ws-123',
    })
  })

  it.skipIf(process.platform === 'win32')(
    'writes the file with owner-only permissions',
    async () => {
      await new YamlStore(path).update(() => ({ token: 'abc-123' }))
      expect(statSync(path).mode & 0o777).toBe(0o600)
    },
  )

  it('leaves the file alone when the change returns undefined', async () => {
    await writeFile(path, 'key: value\n')
    await new YamlStore(path).update(() => undefined)
    expect(readFileSync(path, 'utf8')).toBe('key: value\n')
  })

  it('skips the write when the document is unchanged', async () => {
    await writeFile(path, 'key: value\n')
    const mtime = statSync(path).mtimeMs
    await new YamlStore(path).update(() => ({ key: 'value' }))
    expect(statSync(path).mtimeMs).toBe(mtime)
  })

  it('deletes the file on REMOVE, and is a no-op when there is no file', async () => {
    await writeFile(path, 'key: value\n')
    await new YamlStore(path).update(() => REMOVE)
    expect(existsSync(path)).toBe(false)
    await new YamlStore(path).update(() => REMOVE)
    expect(existsSync(path)).toBe(false)
  })

  it('reads the file again on each call', async () => {
    const store = new YamlStore(path)
    await writeFile(path, 'key: value\n')
    expect(await store.read()).toBe('key: value\n')
    await rm(path)
    expect(await store.read()).toBeUndefined()
  })
})
