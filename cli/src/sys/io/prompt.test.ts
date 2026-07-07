import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { promptText } from './prompt'
import { bufferStreams } from './streams'

function ttyStreams(input: string): ReturnType<typeof bufferStreams> {
  const io = bufferStreams(input)
  ;(io as { isErrTTY: boolean }).isErrTTY = true
  return io
}

function eofStreams(): ReturnType<typeof bufferStreams> {
  const io = bufferStreams()
  const ended = new PassThrough()
  ended.end()
  ;(io as { in: NodeJS.ReadableStream }).in = ended
  ;(io as { isErrTTY: boolean }).isErrTTY = true
  return io
}

const parseString = (raw: string) =>
  raw === 'hello'
    ? { ok: true as const, value: raw }
    : { ok: false as const, error: `expected "hello", got "${raw}"` }

describe('promptText (non-TTY)', () => {
  it('writes label to stderr and returns parsed value', async () => {
    const io = bufferStreams('hello\n')
    const result = await promptText({ io, label: 'Enter name', parse: parseString })
    expect(result).toBe('hello')
    expect(io.errBuf()).toContain('Enter name: ')
  })

  it('includes hint and default in prompt when provided', async () => {
    const io = bufferStreams('hello\n')
    await promptText({
      io,
      label: 'Enter name',
      hint: 'e.g. world',
      default: 'world',
      parse: parseString,
    })
    expect(io.errBuf()).toBe('Enter name (e.g. world) [default: world]: ')
  })

  it('substitutes default on empty Enter', async () => {
    const io = bufferStreams('\n')
    const result = await promptText({
      io,
      label: 'Enter name',
      default: 'hello',
      parse: parseString,
    })
    expect(result).toBe('hello')
  })

  it('throws on invalid input (no retry in non-TTY)', async () => {
    const io = bufferStreams('bad\n')
    await expect(
      promptText({ io, label: 'Enter name', parse: parseString }),
    ).rejects.toThrow(/expected "hello"/)
  })

  it('throws UsageMissingArg on EOF before reading input', async () => {
    const io = bufferStreams()
    const ended = new PassThrough()
    ended.end()
    ;(io as { in: NodeJS.ReadableStream }).in = ended
    await expect(
      promptText({ io, label: 'Enter name', parse: parseString }),
    ).rejects.toThrow(/input closed/)
  })

  it('acceptAsDefault: treats matching input as default', async () => {
    const io = bufferStreams('y\n')
    const result = await promptText({
      io,
      label: 'Enter URL',
      default: 'https://example.com',
      acceptAsDefault: raw => /^y(?:es)?$/i.test(raw),
      parse: raw => ({ ok: true, value: raw }),
    })
    expect(result).toBe('https://example.com')
  })
})

describe('promptText (TTY)', () => {
  it('returns parsed value on first valid input', async () => {
    const io = ttyStreams('hello\n')
    const result = await promptText({ io, label: 'Enter name', parse: parseString })
    expect(result).toBe('hello')
    expect(io.errBuf()).toContain('Enter name: ')
  })

  it('prints error and re-prompts on invalid input, accepts next valid', async () => {
    const io = ttyStreams('bad\nhello\n')
    const result = await promptText({ io, label: 'Enter name', parse: parseString })
    expect(result).toBe('hello')
    const err = io.errBuf()
    expect(err).toContain('expected "hello", got "bad"')
    expect(err.split('Enter name: ').length - 1).toBe(2)
  })

  it('substitutes default on empty Enter', async () => {
    const io = ttyStreams('\n')
    const result = await promptText({
      io,
      label: 'Enter name',
      default: 'hello',
      parse: parseString,
    })
    expect(result).toBe('hello')
  })

  it('acceptAsDefault: treats matching input as empty → default', async () => {
    const io = ttyStreams('y\n')
    const result = await promptText({
      io,
      label: 'Enter URL',
      default: 'https://example.com',
      acceptAsDefault: raw => /^y(?:es)?$/i.test(raw),
      parse: raw => ({ ok: true, value: raw }),
    })
    expect(result).toBe('https://example.com')
  })

  it('acceptAsDefault: case-insensitive — YES and Yes also map to default', async () => {
    for (const input of ['YES\n', 'Yes\n']) {
      const io = ttyStreams(input)
      const result = await promptText({
        io,
        label: 'Enter URL',
        default: 'https://example.com',
        acceptAsDefault: raw => /^y(?:es)?$/i.test(raw),
        parse: raw => ({ ok: true, value: raw }),
      })
      expect(result).toBe('https://example.com')
    }
  })

  it('throws UsageMissingArg on EOF before valid input is given', async () => {
    const io = eofStreams()
    await expect(
      promptText({ io, label: 'Enter name', parse: parseString }),
    ).rejects.toThrow(/input closed/)
  })
})
