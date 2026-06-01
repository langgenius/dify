import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ENV_CONFIG_DIR } from '@/store/dir'
import { HostsBundleSchema, loadHosts, saveHosts } from './hosts'

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

  it('drops unknown top-level fields on parse', () => {
    const parsed = HostsBundleSchema.parse({
      current_host: 'cloud.dify.ai',
      future_field: 42,
      token_storage: 'file',
    })
    expect(parsed.current_host).toBe('cloud.dify.ai')
    expect((parsed as Record<string, unknown>).future_field).toBeUndefined()
  })
})

describe('loadHosts/saveHosts', () => {
  let dir: string
  let prevConfigDir: string | undefined

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'difyctl-hosts-'))
    prevConfigDir = process.env[ENV_CONFIG_DIR]
    process.env[ENV_CONFIG_DIR] = dir
  })

  afterEach(async () => {
    if (prevConfigDir === undefined)
      delete process.env[ENV_CONFIG_DIR]
    else
      process.env[ENV_CONFIG_DIR] = prevConfigDir
    await rm(dir, { recursive: true, force: true })
  })

  it('returns undefined when nothing was saved', () => {
    expect(loadHosts()).toBeUndefined()
  })

  it('round-trips a fully-populated bundle', () => {
    saveHosts({
      current_host: 'cloud.dify.ai',
      scheme: 'https',
      account: { id: 'acct-1', email: 'a@b.c', name: 'A' },
      workspace: { id: 'ws-1', name: 'My Space', role: 'owner' },
      available_workspaces: [
        { id: 'ws-1', name: 'My Space', role: 'owner' },
        { id: 'ws-2', name: 'Other', role: 'normal' },
      ],
      token_storage: 'keychain',
      token_id: 'tok_xyz',
    })
    const loaded = loadHosts()
    expect(loaded?.current_host).toBe('cloud.dify.ai')
    expect(loaded?.scheme).toBe('https')
    expect(loaded?.account?.email).toBe('a@b.c')
    expect(loaded?.workspace?.id).toBe('ws-1')
    expect(loaded?.available_workspaces).toHaveLength(2)
    expect(loaded?.token_storage).toBe('keychain')
    expect(loaded?.token_id).toBe('tok_xyz')
  })

  it('round-trips a file-mode bundle with bearer token', () => {
    saveHosts({
      current_host: 'self.example.com',
      token_storage: 'file',
      tokens: { bearer: 'dfoa_test' },
    })
    const loaded = loadHosts()
    expect(loaded?.tokens?.bearer).toBe('dfoa_test')
    expect(loaded?.token_storage).toBe('file')
  })

  it('overwrites previous bundle on save', () => {
    saveHosts({ current_host: 'old.example.com', token_storage: 'file' })
    saveHosts({ current_host: 'new.example.com', token_storage: 'keychain' })
    const loaded = loadHosts()
    expect(loaded?.current_host).toBe('new.example.com')
    expect(loaded?.token_storage).toBe('keychain')
  })

  it('rejects invalid input at save time', () => {
    expect(() => saveHosts({
      current_host: 'cloud.dify.ai',
      token_storage: 'cloud',
    } as never)).toThrow()
  })
})
