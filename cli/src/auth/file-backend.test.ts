import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FILE_PERM } from '../config/dir.js'
import { FileBackend, TOKENS_FILE_NAME } from './file-backend.js'

describe('FileBackend', () => {
  let dir: string
  let backend: FileBackend

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'difyctl-tokens-'))
    backend = new FileBackend(dir)
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('returns undefined when file is missing', async () => {
    expect(await backend.get('cloud.dify.ai', 'acct-1')).toBeUndefined()
  })

  it('returns empty list when file is missing', async () => {
    expect(await backend.list('cloud.dify.ai')).toEqual([])
  })

  it('round-trips put/get for a single token', async () => {
    await backend.put('cloud.dify.ai', 'acct-1', 'dfoa_abc')
    expect(await backend.get('cloud.dify.ai', 'acct-1')).toBe('dfoa_abc')
  })

  it('list returns accountIds for the given host', async () => {
    await backend.put('cloud.dify.ai', 'acct-1', 'dfoa_a')
    await backend.put('cloud.dify.ai', 'acct-2', 'dfoa_b')
    await backend.put('self.example.com', 'acct-3', 'dfoa_c')
    const ids = await backend.list('cloud.dify.ai')
    expect([...ids].sort()).toEqual(['acct-1', 'acct-2'])
  })

  it('list returns empty array for unknown host', async () => {
    await backend.put('cloud.dify.ai', 'acct-1', 'dfoa_a')
    expect(await backend.list('other.example.com')).toEqual([])
  })

  it('delete removes the entry', async () => {
    await backend.put('cloud.dify.ai', 'acct-1', 'dfoa_a')
    await backend.delete('cloud.dify.ai', 'acct-1')
    expect(await backend.get('cloud.dify.ai', 'acct-1')).toBeUndefined()
  })

  it('delete is a no-op for missing entries', async () => {
    await expect(backend.delete('cloud.dify.ai', 'missing')).resolves.toBeUndefined()
  })

  it('delete prunes empty host entries', async () => {
    await backend.put('cloud.dify.ai', 'acct-1', 'dfoa_a')
    await backend.delete('cloud.dify.ai', 'acct-1')
    expect(await backend.list('cloud.dify.ai')).toEqual([])
  })

  it('overwrites existing token for same host+accountId', async () => {
    await backend.put('cloud.dify.ai', 'acct-1', 'dfoa_old')
    await backend.put('cloud.dify.ai', 'acct-1', 'dfoa_new')
    expect(await backend.get('cloud.dify.ai', 'acct-1')).toBe('dfoa_new')
  })

  it('writes file with mode 0600', async () => {
    await backend.put('cloud.dify.ai', 'acct-1', 'dfoa_a')
    const info = await stat(join(dir, TOKENS_FILE_NAME))
    expect(info.mode & 0o777).toBe(FILE_PERM)
  })

  it('rewrites existing file with mode 0600 even if previously permissive', async () => {
    const path = join(dir, TOKENS_FILE_NAME)
    await writeFile(path, 'hosts: {}\n', { mode: 0o644 })
    await backend.put('cloud.dify.ai', 'acct-1', 'dfoa_a')
    const info = await stat(path)
    expect(info.mode & 0o777).toBe(FILE_PERM)
  })

  it('writes valid YAML readable by a fresh backend', async () => {
    await backend.put('cloud.dify.ai', 'acct-1', 'dfoa_a')
    const fresh = new FileBackend(dir)
    expect(await fresh.get('cloud.dify.ai', 'acct-1')).toBe('dfoa_a')
  })

  it('persists multiple hosts simultaneously', async () => {
    await backend.put('cloud.dify.ai', 'acct-1', 'dfoa_a')
    await backend.put('self.example.com', 'acct-2', 'dfoa_b')
    expect(await backend.get('cloud.dify.ai', 'acct-1')).toBe('dfoa_a')
    expect(await backend.get('self.example.com', 'acct-2')).toBe('dfoa_b')
  })

  it('treats malformed YAML as empty', async () => {
    const path = join(dir, TOKENS_FILE_NAME)
    await writeFile(path, 'not: valid: yaml: [\n', { mode: FILE_PERM })
    expect(await backend.get('cloud.dify.ai', 'acct-1')).toBeUndefined()
  })
})
