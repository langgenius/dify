import { useTempConfigDir } from '@test/fixtures/config-dir'
import { beforeEach, describe, expect, it } from 'vitest'
import { Registry } from '@/auth/hosts'
import { bufferStreams } from '@/sys/io/streams'
import { runUseHost } from './use-host'

describe('runUseHost', () => {
  useTempConfigDir('difyctl-usehost-')
  beforeEach(() => {
    const reg = Registry.empty('file')
    reg.upsert('h1', 'a@x', { account: { id: '1', email: 'a@x', name: 'A' } })
    reg.upsert('h2', 'b@x', { account: { id: '2', email: 'b@x', name: 'B' } })
    reg.setHost('h1')
    reg.setAccount('a@x')
    reg.save()
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
