import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

// Records the Request the WebApp client hands to the shared public request layer.
const sent = vi.hoisted(() => vi.fn<(request: Request, timeout?: false) => void>())
vi.mock('../base', () => ({
  request: async (_url: string, _init: unknown, options: { request: Request; timeout?: false }) => {
    sent(options.request, options.timeout)
    return Response.json({ id: 'file-1', name: 'notes.txt', size: 7 }, { status: 201 })
  },
}))

const NativeRequest = Request
// Firefox's Request has no `body` property; everything else delegates to the native Request.
class RequestWithoutBody {
  readonly method: string
  readonly url: string
  readonly headers: Headers
  readonly signal: AbortSignal
  readonly credentials: RequestCredentials
  readonly cache: RequestCache
  readonly redirect: RequestRedirect
  readonly blob: () => Promise<Blob>
  readonly clone: () => Request
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    const request = new NativeRequest(input, init)
    this.method = request.method
    this.url = request.url
    this.headers = request.headers
    this.signal = request.signal
    this.credentials = request.credentials
    this.cache = request.cache
    this.redirect = request.redirect
    this.blob = () => request.blob()
    this.clone = () => request.clone()
  }
}

describe('webAppClient environment app rewrite', () => {
  beforeEach(() => {
    sent.mockReset()
    window.history.replaceState({}, '', '/environment/chat/env-code')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    window.history.replaceState({}, '', '/')
  })

  it.each([
    ['with Request.body', false],
    ['without Request.body, as in Firefox', true],
  ])('keeps the upload body when rewriting the URL %s', async (_name, withoutBody) => {
    if (withoutBody) vi.stubGlobal('Request', RequestWithoutBody)
    const { webAppClient } = await import('../webapp-client')
    const file = new File(['content'], 'notes.txt', { type: 'text/plain' })

    await webAppClient.files.upload.post({ body: { file } })

    const request = sent.mock.calls[0]![0]
    expect(new URL(request.url).pathname).toMatch(/\/environment\/env-code\/files\/upload$/)
    expect(await request.blob().then((blob) => blob.text())).toContain('filename="notes.txt"')
  })

  it.each([
    ['a plain request', {}, undefined],
    ['an event stream', { stream: true }, false],
    ['a request without a time limit', { timeout: false }, false],
  ] as const)('sets the request time limit for %s', async (_name, context, timeout) => {
    const { webAppClient } = await import('../webapp-client')

    await webAppClient.files.upload.post(
      { body: { file: new File(['content'], 'notes.txt') } },
      { context },
    )

    expect(sent.mock.calls[0]![1]).toBe(timeout)
  })
})
