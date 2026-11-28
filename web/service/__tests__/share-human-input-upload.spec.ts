import { captureAppAccessScope, handleAppAccessError } from '@/features/app-access-error/state'
import { createHttpError } from '@/service/http-error'

// Receives the contract path, method and JSON body of each generated WebApp client request.
const mockPublicRequest = vi.hoisted(() => vi.fn())
const mockUpload = vi.hoisted(() => vi.fn())

vi.mock('../base', () => ({
  del: vi.fn(),
  get: vi.fn(),
  patch: vi.fn(),
  post: vi.fn(),
  delPublic: vi.fn(),
  getPublic: vi.fn(),
  patchPublic: vi.fn(),
  postPublic: vi.fn(),
  request: async (
    url: string,
    _init: unknown,
    options: { request: Request; onUploadProgress?: unknown; timeout?: false },
  ) => {
    // The HITL upload contract: record the token header, multipart or JSON fields and progress hook.
    if (url === '/human-input-forms/files') {
      const contentType = options.request.headers.get('content-type') ?? ''
      const body = contentType.startsWith('multipart/form-data')
        ? Object.fromEntries((await options.request.formData()).entries())
        : await options.request.json()
      const result = await mockUpload({
        authorization: options.request.headers.get('authorization'),
        body,
        onUploadProgress: options.onUploadProgress,
        timeout: options.timeout,
      })
      return Response.json(result ?? {})
    }
    const text = await options.request.text()
    const result = await mockPublicRequest(
      url,
      options.request.method,
      ...(text ? [JSON.parse(text)] : []),
    )
    return Response.json(result ?? {})
  },
  ssePost: vi.fn(),
}))

vi.mock('../webapp-auth', () => ({
  getWebAppAccessToken: vi.fn(),
}))

describe('human input form upload services', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPublicRequest.mockReset()
    mockUpload.mockReset()
    window.history.replaceState({}, '', '/')
    captureAppAccessScope()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-06T00:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should preserve the legacy underscore definition and submit endpoints', async () => {
    const { getHumanInputForm, submitHumanInputForm } = await import('../share')
    mockPublicRequest
      .mockResolvedValueOnce({ form_content: 'review' })
      .mockResolvedValueOnce(undefined)

    await getHumanInputForm('legacy-form-token')
    await submitHumanInputForm('legacy-form-token', {
      inputs: { response: 'approved' },
      action: 'approve',
    })

    expect(mockPublicRequest.mock.calls).toEqual([
      ['/form/human_input/legacy-form-token', 'GET'],
      [
        '/form/human_input/legacy-form-token',
        'POST',
        { inputs: { response: 'approved' }, action: 'approve' },
      ],
    ])
  })

  it('should fetch upload token before local file upload', async () => {
    const { uploadHumanInputFormLocalFile } = await import('../share')
    const file = new File(['content'], 'test.txt', { type: 'text/plain' })
    const onProgressCallback = vi.fn()
    const onSuccessCallback = vi.fn()
    const onErrorCallback = vi.fn()

    mockPublicRequest.mockResolvedValueOnce({
      upload_token: 'hitl-upload-token',
      expires_at: Math.floor(Date.now() / 1000) + 60,
    })
    mockUpload.mockResolvedValueOnce({
      id: 'file-1',
      name: 'test.txt',
      size: 7,
      extension: 'txt',
      mime_type: 'text/plain',
      created_by: 'actor-1',
      created_at: Math.floor(Date.now() / 1000),
      preview_url: null,
      source_url: 'https://example.com/file-preview',
    })

    await uploadHumanInputFormLocalFile({
      formToken: 'local-form-token',
      file,
      onProgressCallback,
      onSuccessCallback,
      onErrorCallback,
    })

    expect(mockPublicRequest.mock.calls).toEqual([
      ['/form/human_input/local-form-token/upload-token', 'POST'],
    ])
    expect(mockUpload).toHaveBeenCalledExactlyOnceWith({
      authorization: 'bearer hitl-upload-token',
      body: { file: expect.objectContaining({ name: 'test.txt', size: 7 }) },
      onUploadProgress: expect.any(Function),
      // Uploads keep the legacy XHR's lack of a time limit.
      timeout: false,
    })
    mockUpload.mock.calls[0]![0].onUploadProgress({ loaded: 3, total: 7 })
    expect(onProgressCallback).toHaveBeenCalledWith(42)
    expect(onSuccessCallback).toHaveBeenCalledWith(expect.objectContaining({ id: 'file-1' }))
    expect(onErrorCallback).not.toHaveBeenCalled()
  })

  it('should fetch upload token before remote file upload', async () => {
    const { uploadHumanInputFormRemoteFileInfo } = await import('../share')

    mockPublicRequest.mockResolvedValueOnce({
      upload_token: 'hitl-remote-token',
      expires_at: Math.floor(Date.now() / 1000) + 60,
    })
    mockUpload.mockResolvedValueOnce({
      id: 'remote-file-1',
      name: 'remote.txt',
      size: 10,
      extension: 'txt',
      mime_type: 'text/plain',
      created_by: 'actor-1',
      created_at: Math.floor(Date.now() / 1000),
      url: 'https://example.com/remote.txt',
    })

    const response = await uploadHumanInputFormRemoteFileInfo(
      'remote-form-token',
      'https://example.com/file.txt',
    )

    expect(mockPublicRequest.mock.calls).toEqual([
      ['/form/human_input/remote-form-token/upload-token', 'POST'],
    ])
    expect(mockUpload).toHaveBeenCalledExactlyOnceWith({
      authorization: 'bearer hitl-remote-token',
      body: { url: 'https://example.com/file.txt' },
      onUploadProgress: undefined,
      // Remote URLs finish only after the server fetches the file, so they have no time limit.
      timeout: false,
    })
    expect(response).toEqual(expect.objectContaining({ id: 'remote-file-1' }))
  })

  it('should cancel local upload before requesting a token when the form is already denied', async () => {
    const { uploadHumanInputFormLocalFile } = await import('../share')
    window.history.replaceState({}, '', '/form/already-denied')
    handleAppAccessError(403, { code: 'ip_access_denied' }, captureAppAccessScope())
    const onErrorCallback = vi.fn()
    const onSuccessCallback = vi.fn()

    await uploadHumanInputFormLocalFile({
      formToken: 'already-denied',
      file: new File(['content'], 'test.txt', { type: 'text/plain' }),
      onProgressCallback: vi.fn(),
      onSuccessCallback,
      onErrorCallback,
    })

    expect(mockPublicRequest).not.toHaveBeenCalled()
    expect(mockUpload).not.toHaveBeenCalled()
    expect(onSuccessCallback).not.toHaveBeenCalled()
    expect(onErrorCallback).toHaveBeenCalledWith(expect.objectContaining({ name: 'AbortError' }))
  })

  it.each(['IP denial', 'navigation'])(
    'should cancel the pending upload chain after %s without uploading to the new scope',
    async (interruption) => {
      const { uploadHumanInputFormRemoteFileInfo } = await import('../share')
      const formToken = `pending-${interruption}`
      window.history.replaceState({}, '', `/form/${formToken}`)
      let finishToken!: (value: { upload_token: string; expires_at: number }) => void
      mockPublicRequest.mockReturnValueOnce(
        new Promise((resolve) => {
          finishToken = resolve
        }),
      )

      const uploadResult = uploadHumanInputFormRemoteFileInfo(
        formToken,
        'https://example.com/file.txt',
      ).catch((error: unknown) => error)
      await vi.waitFor(() => expect(mockPublicRequest).toHaveBeenCalledTimes(1))

      if (interruption === 'IP denial')
        handleAppAccessError(403, { code: 'ip_access_denied' }, captureAppAccessScope())
      else window.history.replaceState({}, '', '/form/another-form')

      finishToken({
        upload_token: 'late-token',
        expires_at: Math.floor(Date.now() / 1000) + 60,
      })

      expect(await uploadResult).toMatchObject({ name: 'AbortError' })
      expect(mockUpload).not.toHaveBeenCalled()
    },
  )

  it('should treat a token error received after navigation as upload cancellation', async () => {
    const { uploadHumanInputFormRemoteFileInfo } = await import('../share')
    window.history.replaceState({}, '', '/form/failed-token')
    let rejectToken!: (error: Response) => void
    mockPublicRequest.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectToken = reject
      }),
    )

    const uploadResult = uploadHumanInputFormRemoteFileInfo(
      'failed-token',
      'https://example.com/file.txt',
    ).catch((error: unknown) => error)
    window.history.replaceState({}, '', '/form/another-form')
    rejectToken(new Response(null, { status: 503 }))

    expect(await uploadResult).toMatchObject({ name: 'AbortError' })
    expect(mockUpload).not.toHaveBeenCalled()
  })

  it('should preserve a normal token failure while the form is still active', async () => {
    const { uploadHumanInputFormRemoteFileInfo } = await import('../share')
    window.history.replaceState({}, '', '/form/unavailable-token')
    const tokenError = createHttpError(new Response(null, { status: 503 }))
    mockPublicRequest.mockRejectedValueOnce(tokenError)

    await expect(
      uploadHumanInputFormRemoteFileInfo('unavailable-token', 'https://example.com/file.txt'),
    ).rejects.toBe(tokenError)
    expect(mockUpload).not.toHaveBeenCalled()
  })

  it('should preserve an IP denial returned by the token request', async () => {
    const { uploadHumanInputFormRemoteFileInfo } = await import('../share')
    window.history.replaceState({}, '', '/form/token-denied')
    const tokenError = createHttpError(new Response(null, { status: 403 }), {
      code: 'ip_access_denied',
    })
    mockPublicRequest.mockImplementationOnce(async () => {
      handleAppAccessError(403, { code: 'ip_access_denied' }, captureAppAccessScope(), tokenError)
      throw tokenError
    })

    await expect(
      uploadHumanInputFormRemoteFileInfo('token-denied', 'https://example.com/file.txt'),
    ).rejects.toBe(tokenError)
    expect(mockUpload).not.toHaveBeenCalled()
  })
})
