import { ORPCError } from '@orpc/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from '@/config'
import { FakeXMLHttpRequest } from '@/test/fake-xhr'

const notifyRequestError = vi.hoisted(() => vi.fn())
vi.mock('@/utils/client', () => ({ isClient: true, isServer: false }))
vi.mock('../../request-error-toast', () => ({
  clearRequestErrorToasts: vi.fn(),
  notifyRequestError,
}))

const loadConsoleClient = async () => (await import('@/service/console')).consoleClient

const waitForSend = () => vi.waitFor(() => expect(FakeXMLHttpRequest.latest().body).not.toBeNull())

const uploadedFile = {
  id: 'file-1',
  name: 'records.csv',
  size: 15,
  extension: 'csv',
  mime_type: 'text/csv',
}

describe('console contract uploads', () => {
  beforeEach(() => {
    FakeXMLHttpRequest.instances = []
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest)
    document.cookie = `${CSRF_COOKIE_NAME()}=csrf-token`
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    notifyRequestError.mockReset()
    document.cookie = `${CSRF_COOKIE_NAME()}=; expires=Thu, 01 Jan 1970 00:00:00 GMT`
  })

  it('sends the contract request over XHR with auth headers and reports progress', async () => {
    const consoleClient = await loadConsoleClient()
    const file = new File(['question,answer'], 'records.csv', { type: 'text/csv' })
    const onUploadProgress = vi.fn()

    const pending = consoleClient.files.upload.post(
      { body: { file, source: 'datasets' } },
      { context: { silent: true, onUploadProgress } },
    )
    await waitForSend()
    const xhr = FakeXMLHttpRequest.latest()

    expect(xhr.method).toBe('POST')
    expect(new URL(xhr.url).pathname).toMatch(/\/files\/upload$/)
    expect(xhr.withCredentials).toBe(true)
    expect(xhr.requestHeaders[CSRF_HEADER_NAME.toLowerCase()]).toBe('csrf-token')
    const sent = await new Response(xhr.body as Blob, {
      headers: { 'content-type': xhr.requestHeaders['content-type']! },
    }).formData()
    expect(sent.get('source')).toBe('datasets')
    expect(sent.get('file')).toMatchObject({ name: 'records.csv' })

    xhr.progress(5, 10)
    expect(onUploadProgress).toHaveBeenCalledExactlyOnceWith({ loaded: 5, total: 10 })

    xhr.respond({ status: 201, body: uploadedFile })
    await expect(pending).resolves.toEqual(uploadedFile)
  })

  it('rejects with the backend error code without a request toast when silent', async () => {
    const consoleClient = await loadConsoleClient()
    const pending = consoleClient.files.upload.post(
      { body: { file: new File(['x'], 'run.exe') } },
      { context: { silent: true, onUploadProgress: vi.fn() } },
    )
    await waitForSend()
    FakeXMLHttpRequest.latest().respond({
      status: 400,
      body: { code: 'file_extension_blocked', message: 'File extension is blocked' },
    })

    const error = await pending.catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(ORPCError)
    expect(error).toMatchObject({ code: 'file_extension_blocked', status: 400 })
    expect(notifyRequestError).not.toHaveBeenCalled()
  })

  it('aborts the XHR through the call signal', async () => {
    const consoleClient = await loadConsoleClient()
    const controller = new AbortController()
    const pending = consoleClient.files.upload.post(
      { body: { file: new File(['x'], 'notes.txt') } },
      { context: { silent: true, onUploadProgress: vi.fn() }, signal: controller.signal },
    )
    await waitForSend()

    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(FakeXMLHttpRequest.latest().aborted).toBe(true)
  })
})
