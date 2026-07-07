import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { selectFromList } from './select'
import { bufferStreams } from './streams'

type Row = { id: string, label: string }
const rows: Row[] = [
  { id: '1', label: 'alpha' },
  { id: '2', label: 'beta' },
  { id: '3', label: 'gamma' },
]

const SHOW_CURSOR = '\x1B[?25h'

type FakeTTYIn = PassThrough & { isTTY: boolean, isRaw: boolean, setRawMode: (mode: boolean) => unknown }

function ttyInput(opts: { failRawMode?: boolean } = {}): FakeTTYIn {
  const stream = new PassThrough() as unknown as FakeTTYIn
  stream.isTTY = true
  stream.isRaw = false
  stream.setRawMode = (mode: boolean): unknown => {
    if (opts.failRawMode === true && mode)
      throw new Error('raw mode unavailable')
    stream.isRaw = mode
    return stream
  }
  return stream
}

function ttyStreams(input: FakeTTYIn): ReturnType<typeof bufferStreams> {
  const io = bufferStreams()
  ;(io as { in: NodeJS.ReadableStream }).in = input
  ;(io as { isErrTTY: boolean }).isErrTTY = true
  return io
}

describe('selectFromList (non-TTY numbered fallback)', () => {
  it('returns the item matching the typed number', async () => {
    const io = bufferStreams('2\n')
    ;(io as { isErrTTY: boolean }).isErrTTY = false
    const picked = await selectFromList({ io, items: rows, header: 'Pick one', render: r => r.label })
    expect(picked.id).toBe('2')
    expect(io.errBuf()).toContain('1) alpha')
    expect(io.errBuf()).toContain('Pick one')
  })

  it('rejects an out-of-range selection', async () => {
    const io = bufferStreams('9\n')
    ;(io as { isErrTTY: boolean }).isErrTTY = false
    await expect(selectFromList({ io, items: rows, header: 'Pick', render: r => r.label }))
      .rejects
      .toThrow(/invalid selection/i)
  })

  it('throws when the list is empty', async () => {
    const io = bufferStreams('1\n')
    ;(io as { isErrTTY: boolean }).isErrTTY = false
    await expect(selectFromList({ io, items: [] as Row[], header: 'Pick', render: r => (r as Row).label }))
      .rejects
      .toThrow(/nothing to select/i)
  })
})

describe('selectFromList (interactive TTY picker)', () => {
  it('moves with arrow keys and resolves on enter, restoring raw mode', async () => {
    const input = ttyInput()
    const io = ttyStreams(input)
    const pick = selectFromList({ io, items: rows, header: 'Pick', render: r => r.label })
    input.write('\x1B[B')
    input.write('\r')
    const picked = await pick
    expect(picked.id).toBe('2')
    expect(input.isRaw).toBe(false)
    expect(io.errBuf()).toContain(SHOW_CURSOR)
  })

  it('cancels on escape', async () => {
    const input = ttyInput()
    const io = ttyStreams(input)
    const pick = selectFromList({ io, items: rows, header: 'Pick', render: r => r.label })
    input.write('\x1B')
    await expect(pick).rejects.toThrow(/cancelled/i)
    expect(input.isRaw).toBe(false)
  })

  it('rejects and restores the terminal when raw-mode setup fails', async () => {
    const input = ttyInput({ failRawMode: true })
    const io = ttyStreams(input)
    await expect(selectFromList({ io, items: rows, header: 'Pick', render: r => r.label }))
      .rejects
      .toThrow(/raw mode unavailable/i)
    expect(input.isRaw).toBe(false)
    expect(io.errBuf()).toContain(SHOW_CURSOR)
  })
})
