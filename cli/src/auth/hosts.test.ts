import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FILE_PERM } from '../config/dir.js'
import { HOSTS_FILE_NAME, HostsBundleSchema, loadHosts, saveHosts } from './hosts.js'

describe('HostsBundleSchema', () => {
  it('parses a minimal logged-out bundle', () => {
    const parsed = HostsBundleSchema.parse({})
    expect(parsed.current_host).toBe('')
    expect(parsed.token_storage).toBe('file')
  })

  it('parses a logged-in keychain bundle', () => {
    const parsed = HostsBundleSchema.parse({
      current_host: 'cloud.dify.ai',
      account: { id: 'acct-1', email: 'a@b.c', name: 'A' },
      workspace: { id: 'ws-1', name: 'My Space', role: 'owner' },
      token_storage: 'keychain',
      token_id: 'tok_xyz',
    })
    expect(parsed.token_storage).toBe('keychain')
    expect(parsed.tokens).toBeUndefined()
  })

  it('parses a logged-in file bundle with bearer', () => {
    const parsed = HostsBundleSchema.parse({
      current_host: 'cloud.dify.ai',
      token_storage: 'file',
      tokens: { bearer: 'dfoa_xxx' },
    })
    expect(parsed.tokens?.bearer).toBe('dfoa_xxx')
  })

  it('rejects unknown token_storage values', () => {
    expect(() => HostsBundleSchema.parse({ token_storage: 'cloud' })).toThrow()
  })

  it('keeps available_workspaces when provided', () => {
    const parsed = HostsBundleSchema.parse({
      available_workspaces: [
        { id: 'a', name: 'A', role: 'owner' },
        { id: 'b', name: 'B', role: 'member' },
      ],
    })
    expect(parsed.available_workspaces).toHaveLength(2)
  })
})

describe('loadHosts/saveHosts', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'difyctl-hosts-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('returns undefined when file is missing', async () => {
    expect(await loadHosts(dir)).toBeUndefined()
  })

  it('round-trips bundle through YAML', async () => {
    await saveHosts(dir, {
      current_host: 'cloud.dify.ai',
      account: { id: 'acct-1', email: 'a@b.c', name: 'A' },
      workspace: { id: 'ws-1', name: 'My Space', role: 'owner' },
      token_storage: 'keychain',
      token_id: 'tok_xyz',
    })
    const loaded = await loadHosts(dir)
    expect(loaded?.current_host).toBe('cloud.dify.ai')
    expect(loaded?.account?.email).toBe('a@b.c')
    expect(loaded?.token_storage).toBe('keychain')
  })

  it('writes file with mode 0600', async () => {
    await saveHosts(dir, { current_host: 'cloud.dify.ai', token_storage: 'file' })
    const info = await stat(join(dir, HOSTS_FILE_NAME))
    expect(info.mode & 0o777).toBe(FILE_PERM)
  })

  it('rewrites permissive existing file with mode 0600', async () => {
    const path = join(dir, HOSTS_FILE_NAME)
    await writeFile(path, 'current_host: ""\ntoken_storage: file\n', { mode: 0o644 })
    await saveHosts(dir, { current_host: 'cloud.dify.ai', token_storage: 'file' })
    const info = await stat(path)
    expect(info.mode & 0o777).toBe(FILE_PERM)
  })

  it('atomic write: temp file does not survive on success', async () => {
    await saveHosts(dir, { current_host: 'cloud.dify.ai', token_storage: 'file' })
    const { readdir } = await import('node:fs/promises')
    const entries = await readdir(dir)
    expect(entries.filter(n => n.includes('.tmp.'))).toHaveLength(0)
  })

  it('drops unknown top-level fields', async () => {
    const path = join(dir, HOSTS_FILE_NAME)
    await writeFile(path, 'current_host: cloud.dify.ai\nfuture_field: 42\ntoken_storage: file\n', { mode: FILE_PERM })
    const loaded = await loadHosts(dir)
    expect(loaded?.current_host).toBe('cloud.dify.ai')
    expect((loaded as Record<string, unknown> | undefined)?.future_field).toBeUndefined()
  })

  it('throws on malformed YAML', async () => {
    const path = join(dir, HOSTS_FILE_NAME)
    await writeFile(path, ': : :\n', { mode: FILE_PERM })
    await expect(loadHosts(dir)).rejects.toThrow()
  })

  it('throws when YAML contradicts schema', async () => {
    const path = join(dir, HOSTS_FILE_NAME)
    await writeFile(path, 'token_storage: cloud\n', { mode: FILE_PERM })
    await expect(loadHosts(dir)).rejects.toThrow()
  })

  it('produces YAML with stable keys', async () => {
    await saveHosts(dir, {
      current_host: 'cloud.dify.ai',
      token_storage: 'file',
      tokens: { bearer: 'dfoa_x' },
    })
    const raw = await readFile(join(dir, HOSTS_FILE_NAME), 'utf8')
    expect(raw).toContain('current_host: cloud.dify.ai')
    expect(raw).toContain('bearer: dfoa_x')
  })
})
