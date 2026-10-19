import type { BufferStreams } from '@/sys/io/streams'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { ioService } from '@/plugins/io'
import { TOKENS_FILE_NAME } from '@/plugins/token'
import { bufferStreams } from '@/sys/io/streams'
import { localFile } from './local-file'
import { FileTokenStore, TOKENS_SCHEMA } from './token-store'

describe('FileTokenStore', () => {
  let dir: string
  let file: string
  let streams: BufferStreams

  beforeEach(() => {
    streams = bufferStreams()
    dir = mkdtempSync(join(tmpdir(), 'difyctl-tok-'))
    file = join(dir, TOKENS_FILE_NAME)
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function open(): FileTokenStore {
    return new FileTokenStore(localFile(file, TOKENS_SCHEMA, ioService(streams).notice))
  }

  it('returns empty string for a missing credential', async () => {
    const s = open()
    expect(await s.read('https://cloud.dify.ai', 'a@x.com')).toBe('')
  })

  it('round-trips a bearer with dots and @ kept literal', async () => {
    const s = open()
    await s.write('https://cloud.dify.ai', 'a.b@x.com', 'dfoa_secret')
    expect(await s.read('https://cloud.dify.ai', 'a.b@x.com')).toBe('dfoa_secret')
  })

  it('keeps multiple accounts under one host and isolates hosts', async () => {
    const s = open()
    await s.write('https://cloud.dify.ai', 'a@x.com', 'A')
    await s.write('https://cloud.dify.ai', 'b@x.com', 'B')
    await s.write('https://self.example.com', 'a@x.com', 'C')
    expect(await s.read('https://cloud.dify.ai', 'a@x.com')).toBe('A')
    expect(await s.read('https://cloud.dify.ai', 'b@x.com')).toBe('B')
    expect(await s.read('https://self.example.com', 'a@x.com')).toBe('C')
  })

  it('preserves concurrent writes from separate stores', async () => {
    let updateCount = 0
    let releaseFirstUpdate!: () => void
    let signalFirstUpdate!: () => void
    let signalSecondRequest!: () => void
    const firstUpdateStarted = new Promise<void>((resolve) => {
      signalFirstUpdate = resolve
    })
    const secondUpdateRequested = new Promise<void>((resolve) => {
      signalSecondRequest = resolve
    })
    const firstUpdateGate = new Promise<void>((resolve) => {
      releaseFirstUpdate = resolve
    })
    let secondTransformEntered = false

    function openWithSynchronizedUpdate(): FileTokenStore {
      const source = localFile(file, TOKENS_SCHEMA, ioService(streams).notice)
      return new FileTokenStore({
        ...source,
        update: async (transform) => {
          updateCount += 1
          if (updateCount === 2) signalSecondRequest()
          await source.update(async (doc) => {
            if (updateCount === 1) {
              signalFirstUpdate()
              await firstUpdateGate
            } else {
              secondTransformEntered = true
            }
            return transform(doc)
          })
        },
      })
    }

    const first = openWithSynchronizedUpdate()
    const second = openWithSynchronizedUpdate()
    const firstWrite = first.write('https://one.example.com', 'a@x.com', 'A')
    await firstUpdateStarted
    const secondWrite = second.write('https://two.example.com', 'b@x.com', 'B')
    await secondUpdateRequested
    await new Promise<void>((resolve) => setImmediate(resolve))
    const secondWaitedForLock = !secondTransformEntered
    releaseFirstUpdate()
    await Promise.all([firstWrite, secondWrite])

    expect(secondWaitedForLock).toBe(true)

    const result = open()
    expect(await result.read('https://one.example.com', 'a@x.com')).toBe('A')
    expect(await result.read('https://two.example.com', 'b@x.com')).toBe('B')
  })

  it('persists the nested shape on disk', async () => {
    const s = open()
    await s.write('https://cloud.dify.ai', 'a@x.com', 'A')
    expect(readFileSync(file, 'utf8')).toBe('tokens:\n  https://cloud.dify.ai:\n    a@x.com: A\n')
  })

  it('reads a difyctl v1 file in place and drops its version on the next write', async () => {
    writeFileSync(file, 'version: 1\ntokens:\n  h:\n    e: dfoa_v1\n')
    const s = open()
    expect(await s.read('h', 'e')).toBe('dfoa_v1')
    await s.write('h', 'f', 'dfoa_v2')
    expect(readFileSync(file, 'utf8')).toBe('tokens:\n  h:\n    e: dfoa_v1\n    f: dfoa_v2\n')
    expect(streams.errBuf()).toBe('')
  })

  it('ignores unknown and future keys without a notice', async () => {
    writeFileSync(file, 'schema_version: 99\nfuture_key: x\ntokens:\n  h:\n    e: dfoa_x\n')
    expect(await open().read('h', 'e')).toBe('dfoa_x')
    expect(streams.errBuf()).toBe('')
  })

  it('drops a bad entry with a notice and keeps the rest', async () => {
    writeFileSync(file, 'tokens:\n  h:\n    e: dfoa_x\n    bad: 7\n  g: nope\n')
    const s = open()
    expect(await s.read('h', 'e')).toBe('dfoa_x')
    expect(streams.errBuf()).toBe(
      `${file}: ignoring the invalid value of tokens.h.bad\n${file}: ignoring the invalid value of tokens.g\n`,
    )
  })

  it.each([
    ['not valid YAML', 'tokens: [unclosed\n', /is not valid YAML/],
    ['not a mapping', 'just text\n', /is not a YAML mapping/],
  ])(
    'reads a file that is %s as empty and replaces it on the next write',
    async (_l, raw, note) => {
      writeFileSync(file, raw)
      const s = open()
      expect(await s.read('h', 'e')).toBe('')
      expect(streams.errBuf()).toMatch(note)
      await s.write('h', 'e', 'dfoa_y')
      expect(readFileSync(file, 'utf8')).toBe('tokens:\n  h:\n    e: dfoa_y\n')
    },
  )

  it('remove deletes the credential and prunes the empty host map', async () => {
    const s = open()
    await s.write('https://cloud.dify.ai', 'a@x.com', 'A')
    await s.remove('https://cloud.dify.ai', 'a@x.com')
    expect(await s.read('https://cloud.dify.ai', 'a@x.com')).toBe('')
    const raw = readFileSync(file, 'utf8')
    expect(raw).not.toContain('cloud.dify.ai')
  })

  it('remove is a no-op for an absent credential', async () => {
    const s = open()
    await expect(s.remove('h', 'e')).resolves.not.toThrow()
  })
})
