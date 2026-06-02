import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Registry } from '@/auth/hosts'
import { ENV_CONFIG_DIR } from '@/store/dir'
import { bufferStreams } from '@/sys/io/streams'
import { runUseHost } from './use-host'

describe('runUseHost', () => {
  let dir: string
  let prev: string | undefined
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'difyctl-usehost-'))
    prev = process.env[ENV_CONFIG_DIR]
    process.env[ENV_CONFIG_DIR] = dir
    const reg = Registry.empty('file')
    reg.upsert('h1', 'a@x', { account: { id: '1', email: 'a@x', name: 'A' } })
    reg.upsert('h2', 'b@x', { account: { id: '2', email: 'b@x', name: 'B' } })
    reg.setHost('h1')
    reg.setAccount('a@x')
    reg.save()
  })
  afterEach(async () => {
    if (prev === undefined)
      delete process.env[ENV_CONFIG_DIR]
    else process.env[ENV_CONFIG_DIR] = prev
    await rm(dir, { recursive: true, force: true })
  })

  it('switches current_host when host is valid', async () => {
    await runUseHost({ io: bufferStreams(), host: 'h2' })
    expect(Registry.load().current_host).toBe('h2')
  })

  it('errors when host is unknown, listing valid hosts', async () => {
    await expect(runUseHost({ io: bufferStreams(), host: 'nope' })).rejects.toThrow(/h1.*h2|unknown host/i)
  })

  it('errors in non-TTY when host omitted', async () => {
    const io = bufferStreams()
    ;(io as { isErrTTY: boolean }).isErrTTY = false
    await expect(runUseHost({ io, host: undefined })).rejects.toThrow(/--domain/i)
  })

  it('errors when no hosts exist', async () => {
    Registry.empty('file').save()
    await expect(runUseHost({ io: bufferStreams(), host: 'h1' })).rejects.toThrow(/no hosts|not logged in/i)
  })
})
