import type { Options as LockOptions } from 'lockfile'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import lockfile from 'lockfile'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import * as sys from '@/sys'
import { BadYamlFormatError, ConcurrentAccessError } from './errors'
import { loadYaml, REMOVE, YamlStore } from './store'

let dir: string
let path: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'difyctl-yaml-store-'))
  path = join(dir, 'config.yml')
})

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
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
  // Own the release task so failures cannot leave it racing with afterEach.
  async function withHeldLock<T>(
    operation: () => Promise<T>,
    beforeRelease: () => Promise<void> = async () => {},
  ): Promise<T> {
    await writeFile(`${path}.lock`, '')
    const released = (async () => {
      await delay(HOLD_MS)
      await beforeRelease()
      await unlink(`${path}.lock`)
    })()
    try {
      const [result] = await Promise.all([operation(), released])
      return result
    } finally {
      await released
    }
  }

  it('a read waits while another process holds the lock', async () => {
    await writeFile(path, 'key: value\n')
    await withHeldLock(async () => {
      const started = Date.now()
      expect(await new YamlStore(path).read()).toBe('key: value\n')
      // Measure the read itself, before the helper joins fixture cleanup.
      expect(Date.now() - started).toBeGreaterThanOrEqual(HOLD_MS / 2)
    })
  })

  it('an update waits while another process holds the lock, then sees its write', async () => {
    await writeFile(path, 'key: original\n')
    let seen: string | undefined
    await withHeldLock(
      () =>
        new YamlStore(path).update((content) => {
          seen = content
          return { key: 'mine' }
        }),
      () => writeFile(path, 'key: theirs\n'),
    )
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

describe('YamlStore Windows lock contention', () => {
  // Select the options overload for Vitest; this is the same lockfile object.
  const locks: {
    lock: (path: string, opts: LockOptions, callback: (error: Error | null) => void) => void
  } = lockfile

  function windows() {
    vi.spyOn(sys, 'resolvePlatform').mockReturnValue({
      ...sys.resolvePlatform(),
      id: () => 'win32',
    })
  }

  function denied(syscall = 'open'): NodeJS.ErrnoException {
    return Object.assign(new Error('lock file is pending deletion'), {
      code: 'EPERM',
      syscall,
      path: `${path}.lock`,
    })
  }

  it('waits for a Windows lock file pending deletion, then reads normally', async () => {
    windows()
    await writeFile(path, 'key: value\n')
    const lock = vi.spyOn(locks, 'lock').mockImplementationOnce((_, _opts, callback) => {
      callback(denied())
    })
    await expect(new YamlStore(path).read()).resolves.toBe('key: value\n')
    expect(lock).toHaveBeenCalledTimes(2)
    expect(existsSync(`${path}.lock`)).toBe(false)
  })

  it('keeps the original wait budget when Windows keeps denying the lock', async () => {
    windows()
    vi.useFakeTimers()
    const error = denied()
    const lock = vi.spyOn(locks, 'lock').mockImplementation((_, _opts, callback) => {
      callback(error)
    })
    const rejected = expect(new YamlStore(path).read()).rejects.toBe(error)
    // Let mkdir complete before advancing the acquisition clock.
    await vi.waitFor(() => expect(lock).toHaveBeenCalled())
    await vi.advanceTimersByTimeAsync(5_000)
    await rejected
    expect(lock.mock.calls.length).toBeGreaterThan(1)
    expect(lock.mock.calls.at(-1)?.[1].wait).toBe(0)
  })

  it('shares the wait budget between Windows deletion and an existing lock', async () => {
    windows()
    vi.useFakeTimers()
    const lock = vi
      .spyOn(locks, 'lock')
      .mockImplementation((_, opts, callback) => {
        setTimeout(
          () => callback(Object.assign(new Error('locked'), { code: 'EEXIST' })),
          opts.wait,
        )
      })
      .mockImplementationOnce((_, _opts, callback) => callback(denied()))
    const rejected = expect(new YamlStore(path).read()).rejects.toBeInstanceOf(
      ConcurrentAccessError,
    )
    await vi.waitFor(() => expect(lock).toHaveBeenCalled())
    await vi.advanceTimersByTimeAsync(5_000)
    await rejected
    expect(lock).toHaveBeenCalledTimes(2)
    expect(lock.mock.calls[1]?.[1].wait).toBeLessThan(5_000)
  })

  it('propagates EPERM on other platforms without retrying', async () => {
    vi.spyOn(sys, 'resolvePlatform').mockReturnValue({
      ...sys.resolvePlatform(),
      id: () => 'linux',
    })
    const error = denied()
    const lock = vi.spyOn(locks, 'lock').mockImplementation((_, _opts, callback) => {
      callback(error)
    })
    await expect(new YamlStore(path).read()).rejects.toBe(error)
    expect(lock).toHaveBeenCalledTimes(1)
  })

  it.each([
    { code: 'EPERM', syscall: 'stat' },
    { code: 'EACCES', syscall: 'open' },
    { code: 'EPERM', syscall: 'open', path: 'another.lock' },
  ])('propagates unrelated Windows errors without retrying: %j', async (details) => {
    windows()
    const error = Object.assign(denied(), details)
    const lock = vi.spyOn(locks, 'lock').mockImplementation((_, _opts, callback) => {
      callback(error)
    })
    await expect(new YamlStore(path).read()).rejects.toBe(error)
    expect(lock).toHaveBeenCalledTimes(1)
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
