import { describe, expect, it } from 'vitest'
import { parseSSE } from './sse.js'

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch))
      c.close()
    },
  })
}

async function collect(s: ReadableStream<Uint8Array>): Promise<{ name: string, data: string, id?: string }[]> {
  const out: { name: string, data: string, id?: string }[] = []
  const dec = new TextDecoder()
  for await (const ev of parseSSE(s))
    out.push({ name: ev.name, data: dec.decode(ev.data), id: ev.id })
  return out
}

describe('parseSSE', () => {
  it('emits one event per blank-line-terminated record', async () => {
    const s = streamOf('event: message\ndata: hello\n\nevent: ping\ndata: \n\n')
    const got = await collect(s)
    expect(got).toEqual([
      { name: 'message', data: 'hello', id: undefined },
      { name: 'ping', data: '', id: undefined },
    ])
  })

  it('joins multi-line data with newlines', async () => {
    const s = streamOf('event: message\ndata: line1\ndata: line2\n\n')
    const got = await collect(s)
    expect(got[0]?.data).toBe('line1\nline2')
  })

  it('propagates id field', async () => {
    const s = streamOf('id: 42\nevent: m\ndata: x\n\n')
    expect((await collect(s))[0]?.id).toBe('42')
  })

  it('skips comment lines', async () => {
    const s = streamOf(': comment\nevent: m\ndata: x\n\n')
    expect(await collect(s)).toEqual([{ name: 'm', data: 'x', id: undefined }])
  })

  it('survives chunk boundaries inside a field', async () => {
    const s = streamOf('event: mes', 'sage\nda', 'ta: hel', 'lo\n\n')
    expect((await collect(s))[0]).toEqual({ name: 'message', data: 'hello', id: undefined })
  })

  it('handles multi-byte utf-8 split across chunks', async () => {
    const enc = new TextEncoder().encode('event: m\ndata: 😀\n\n')
    const a = enc.slice(0, 14)
    const b = enc.slice(14)
    const s = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(a)
        c.enqueue(b)
        c.close()
      },
    })
    expect((await collect(s))[0]?.data).toBe('😀')
  })

  it('aborts when signal fires', async () => {
    const ctrl = new AbortController()
    const slow = new ReadableStream<Uint8Array>({
      pull(c) {
        c.enqueue(new TextEncoder().encode('event: m\ndata: x\n\n'))
      },
    })
    let seen = 0
    let caught: unknown
    try {
      for await (const _ of parseSSE(slow, ctrl.signal)) {
        seen++
        if (seen === 1)
          ctrl.abort()
      }
    }
    catch (e) {
      caught = e
    }
    expect(seen).toBeGreaterThanOrEqual(1)
    expect(seen).toBeLessThan(50)
    expect((caught as Error).name).toBe('AbortError')
  })
})
