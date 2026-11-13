import Cookies from 'js-cookie'
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from '@/config'
// oxlint-disable-next-line no-restricted-imports -- Exercise the generated transport's existing auth refresh and CSRF pipeline with XHR progress.
import { request } from './base'
import { fetchWithUploadProgress } from './upload-progress'

const refresh = vi.hoisted(() => vi.fn())
vi.mock('./refresh-token', () => ({ refreshAccessTokenOrReLogin: refresh }))
vi.mock('@/app/notifications', () => ({ toast: { error: vi.fn(), add: vi.fn() } }))

class UploadRequest {
  static sent: UploadRequest[] = []
  upload = { onprogress: null as ((event: ProgressEvent) => void) | null }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null
  status = 201
  statusText = 'Created'
  response = new TextEncoder().encode('{"id":"uploaded-image"}').buffer
  responseType = ''
  withCredentials = false
  body: Blob | null = null
  headers = new Headers()
  open = vi.fn()
  abort = vi.fn(() => this.onabort?.())
  setRequestHeader = (name: string, value: string) => this.headers.set(name, value)
  getAllResponseHeaders = () => 'Content-Type: application/json\r\nX-Request-Id: upload-request\r\n'
  send = (body: Blob | null) => {
    this.body = body
    UploadRequest.sent.push(this)
  }
}

beforeEach(() => {
  UploadRequest.sent = []
  vi.stubGlobal('XMLHttpRequest', UploadRequest)
  refresh.mockResolvedValue(undefined)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  Cookies.remove(CSRF_COOKIE_NAME())
})

function uploadRequest(signal?: AbortSignal) {
  const form = new FormData()
  form.set('file', new File(['image bytes'], 'diagram.png', { type: 'image/png' }))
  return new Request('http://localhost/console/api/files/upload', {
    method: 'POST',
    body: form,
    signal,
    credentials: 'include',
  })
}

it('sends multipart bytes with CSRF and cookies, and reports real upload progress before completion', async () => {
  Cookies.set(CSRF_COOKIE_NAME(), 'test-csrf')
  const outgoing = uploadRequest()
  const onUploadProgress = vi.fn()
  // oxlint-disable-next-line typescript/no-deprecated -- Verify the shared auth/error pipeline used by the generated client upload adapter.
  const pending = request<Response>(
    outgoing.url,
    {},
    {
      fetchCompat: true,
      request: outgoing,
      onUploadProgress,
      silent: true,
    },
  )
  await vi.waitFor(() => expect(UploadRequest.sent).toHaveLength(1))
  const xhr = UploadRequest.sent[0]!
  expect(xhr.open).toHaveBeenCalledWith('POST', outgoing.url)
  expect(xhr.withCredentials).toBe(true)
  expect(xhr.headers.get(CSRF_HEADER_NAME)).toBe('test-csrf')
  const multipart = new Response(xhr.body, { headers: xhr.headers })
  const form = await multipart.formData()
  const file = form.get('file')
  expect(file).toBeInstanceOf(File)
  if (!(file instanceof File)) throw new Error('Expected the selected file')
  expect(file.name).toBe('diagram.png')
  expect(await file.text()).toBe('image bytes')
  xhr.upload.onprogress?.(
    new ProgressEvent('progress', { lengthComputable: true, loaded: 45, total: 100 }),
  )
  expect(onUploadProgress).toHaveBeenCalledWith(45)
  xhr.onload?.()
  const response = await pending
  expect(response.status).toBe(201)
  expect(response.headers.get('x-request-id')).toBe('upload-request')
  await expect(response.json()).resolves.toEqual({ id: 'uploaded-image' })
})

it('can replay the multipart upload after refreshing expired credentials', async () => {
  const outgoing = uploadRequest()
  // oxlint-disable-next-line typescript/no-deprecated -- Verify the shared auth/error pipeline used by the generated client upload adapter.
  const pending = request<Response>(
    outgoing.url,
    {},
    {
      fetchCompat: true,
      request: outgoing,
      onUploadProgress: vi.fn(),
      silent: true,
    },
  )
  await vi.waitFor(() => expect(UploadRequest.sent).toHaveLength(1))
  const first = UploadRequest.sent[0]!
  first.status = 401
  first.response = new TextEncoder().encode(
    '{"code":"unauthorized","message":"Expired","status":401}',
  ).buffer
  first.onload?.()
  await vi.waitFor(() => expect(UploadRequest.sent).toHaveLength(2))
  const second = UploadRequest.sent[1]!
  expect(await second.body?.text()).toBe(await first.body?.text())
  second.onload?.()
  await expect((await pending).json()).resolves.toEqual({ id: 'uploaded-image' })
  expect(refresh).toHaveBeenCalledOnce()
})

it('aborts an in-flight upload when the image is removed', async () => {
  const controller = new AbortController()
  const pending = fetchWithUploadProgress(uploadRequest(controller.signal), vi.fn())
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  await vi.waitFor(() => expect(UploadRequest.sent).toHaveLength(1))
  controller.abort()
  await rejected
  expect(UploadRequest.sent[0]?.abort).toHaveBeenCalledOnce()
})

it('does not send a request cancelled before its body was prepared', async () => {
  const controller = new AbortController()
  controller.abort()
  await expect(
    fetchWithUploadProgress(uploadRequest(controller.signal), vi.fn()),
  ).rejects.toMatchObject({ name: 'AbortError' })
  expect(UploadRequest.sent).toHaveLength(0)
})

it('rejects network failures so the image can offer retry', async () => {
  const pending = fetchWithUploadProgress(uploadRequest(), vi.fn())
  const rejected = expect(pending).rejects.toThrow('Failed to fetch')
  await vi.waitFor(() => expect(UploadRequest.sent).toHaveLength(1))
  UploadRequest.sent[0]?.onerror?.()
  await rejected
})

it('preserves a server rejection through the shared error pipeline', async () => {
  const outgoing = uploadRequest()
  // oxlint-disable-next-line typescript/no-deprecated -- Verify the shared auth/error pipeline used by the generated client upload adapter.
  const pending = request<Response>(
    outgoing.url,
    {},
    {
      fetchCompat: true,
      request: outgoing,
      onUploadProgress: vi.fn(),
      silent: true,
    },
  )
  const rejected = expect(pending).rejects.toMatchObject({ status: 413, message: 'File too large' })
  await vi.waitFor(() => expect(UploadRequest.sent).toHaveLength(1))
  const xhr = UploadRequest.sent[0]!
  xhr.status = 413
  xhr.response = new TextEncoder().encode(
    '{"code":"file_too_large","message":"File too large","status":413}',
  ).buffer
  xhr.onload?.()
  await rejected
})
