import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { HttpClient } from './client'

describe('opaque binary request bodies', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it.each([
    ['Buffer', () => Buffer.from([0, 255, 13, 10])],
    ['typed array', () => new Uint16Array([0x1234, 0x5678])],
    ['DataView', () => new DataView(new Uint8Array([9, 0, 255, 8]).buffer, 1, 2)],
    ['ArrayBuffer', () => new Uint8Array([0, 255]).buffer],
    ['Blob', () => new Blob([new Uint8Array([0, 255])])],
  ] as const)('transmits %s bytes without interpreting attached properties as JSON fields', async (_, makeBody) => {
    const body = makeBody()
    // Binary views can carry application metadata; it is not part of the wire body.
    Object.assign(body, { user: 123, label: 'x'.repeat(10001) })
    const expected = body instanceof Blob
      ? new Uint8Array(await body.arrayBuffer())
      : ArrayBuffer.isView(body)
        ? new Uint8Array(body.buffer, body.byteOffset, body.byteLength)
        : new Uint8Array(body)
    let received: Uint8Array | undefined
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      received = new Uint8Array(await new Request(url, init).arrayBuffer())
      return new Response('{}')
    }))

    await new HttpClient({ apiKey: 'test' }).requestRaw({ method: 'POST', path: '/upload', data: body })

    expect(received).toEqual(expected)
  })

  it('does not enumerate every byte of a large upload', async () => {
    const body = Buffer.alloc(1024 * 1024, 42)
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response('{}')))
    const entries = vi.spyOn(Object, 'entries')

    await new HttpClient({ apiKey: 'test' }).requestRaw({ method: 'POST', path: '/upload', data: body })

    expect(entries.mock.calls.some(([value]) => value === body)).toBe(false)
  })

  it('preserves URL-encoded bodies independently of attached properties', async () => {
    const body = Object.assign(new URLSearchParams({ user: 'a+b', text: '你好' }), { user: 123 })
    let received = ''
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      received = await new Request(url, init).text()
      return new Response('{}')
    }))

    await new HttpClient({ apiKey: 'test' }).requestRaw({ method: 'POST', path: '/upload', data: body })

    expect(received).toBe('user=a%2Bb&text=%E4%BD%A0%E5%A5%BD')
  })
})
