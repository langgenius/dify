import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { FakeXMLHttpRequest } from '@/test/fake-xhr'
import { createXhrFetch } from '../xhr-fetch'

const waitForSend = () => vi.waitFor(() => expect(FakeXMLHttpRequest.latest().body).not.toBeNull())

describe('createXhrFetch', () => {
  beforeEach(() => {
    FakeXMLHttpRequest.instances = []
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('sends the serialized request and resolves the response', async () => {
    const onUploadProgress = vi.fn()
    const body = new FormData()
    body.append('file', new File(['content'], 'notes.txt', { type: 'text/plain' }))

    const pending = createXhrFetch(onUploadProgress)('https://dify.test/console/api/files/upload', {
      method: 'POST',
      body,
      credentials: 'include',
      headers: { 'X-CSRF-Token': 'csrf' },
    })
    await waitForSend()
    const xhr = FakeXMLHttpRequest.latest()

    expect(xhr.method).toBe('POST')
    expect(xhr.url).toBe('https://dify.test/console/api/files/upload')
    expect(xhr.withCredentials).toBe(true)
    expect(xhr.requestHeaders['x-csrf-token']).toBe('csrf')
    expect(xhr.requestHeaders['content-type']).toMatch(/^multipart\/form-data; boundary=/)
    expect(await (xhr.body as Blob).text()).toContain('filename="notes.txt"')

    xhr.progress(1, 4, false)
    xhr.progress(1, 4)
    xhr.progress(4, 4)
    expect(onUploadProgress.mock.calls).toEqual([
      [{ loaded: 1, total: 4 }],
      [{ loaded: 4, total: 4 }],
    ])

    xhr.respond({ status: 201, body: { id: 'file-1' }, headers: { 'x-request-id': 'req' } })
    const response = await pending
    expect(response.status).toBe(201)
    expect(response.headers.get('x-request-id')).toBe('req')
    expect(await response.json()).toEqual({ id: 'file-1' })
  })

  it('sends the body when the browser has no Request.body, as in Firefox', async () => {
    const NativeRequest = Request
    // Firefox's Request has no `body` property; everything else delegates to the native Request.
    class RequestWithoutBody {
      readonly method: string
      readonly url: string
      readonly headers: Headers
      readonly signal: AbortSignal
      readonly credentials: RequestCredentials
      readonly blob: () => Promise<Blob>
      constructor(input: RequestInfo | URL, init?: RequestInit) {
        const request = new NativeRequest(input, init)
        this.method = request.method
        this.url = request.url
        this.headers = request.headers
        this.signal = request.signal
        this.credentials = request.credentials
        this.blob = () => request.blob()
      }
    }
    vi.stubGlobal('Request', RequestWithoutBody)
    const body = new FormData()
    body.append('file', new File(['content'], 'notes.txt', { type: 'text/plain' }))

    const pending = createXhrFetch(vi.fn())('https://dify.test/upload', { method: 'POST', body })
    await waitForSend()

    expect(await (FakeXMLHttpRequest.latest().body as Blob).text()).toContain(
      'filename="notes.txt"',
    )
    FakeXMLHttpRequest.latest().respond({ status: 201, body: { id: 'file-1' } })
    await expect(pending).resolves.toMatchObject({ status: 201 })
  })

  it('sends no body for GET requests', async () => {
    const pending = createXhrFetch(vi.fn())('https://dify.test/files')
    await vi.waitFor(() => expect(FakeXMLHttpRequest.latest().method).toBe('GET'))
    expect(FakeXMLHttpRequest.latest().body).toBeNull()
    FakeXMLHttpRequest.latest().respond({ status: 200, body: {} })
    await pending
  })

  it('resolves error statuses as responses for the request layer to decode', async () => {
    const pending = createXhrFetch(vi.fn())('https://dify.test/upload', {
      method: 'POST',
      body: 'x',
    })
    await waitForSend()
    FakeXMLHttpRequest.latest().respond({ status: 413, body: { code: 'file_too_large' } })

    const response = await pending
    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({ code: 'file_too_large' })
  })

  it('aborts the XHR when the signal aborts', async () => {
    const controller = new AbortController()
    const pending = createXhrFetch(vi.fn())('https://dify.test/upload', {
      method: 'POST',
      body: 'x',
      signal: controller.signal,
    })
    await waitForSend()

    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(FakeXMLHttpRequest.latest().aborted).toBe(true)
  })

  it('does not send when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      createXhrFetch(vi.fn())('https://dify.test/upload', {
        method: 'POST',
        body: 'x',
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(FakeXMLHttpRequest.instances).toHaveLength(0)
  })

  it('rejects network failures like fetch', async () => {
    const pending = createXhrFetch(vi.fn())('https://dify.test/upload', {
      method: 'POST',
      body: 'x',
    })
    await waitForSend()
    FakeXMLHttpRequest.latest().fail()

    await expect(pending).rejects.toThrow(new TypeError('Failed to fetch'))
  })

  it('returns a null body for statuses that cannot carry one', async () => {
    const pending = createXhrFetch(vi.fn())('https://dify.test/upload', {
      method: 'POST',
      body: 'x',
    })
    await waitForSend()
    FakeXMLHttpRequest.latest().respond({ status: 204 })

    expect((await pending).body).toBeNull()
  })
})
