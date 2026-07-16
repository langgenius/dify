const mockPostPublic = vi.hoisted(() => vi.fn())
const mockUpload = vi.hoisted(() => vi.fn())

vi.mock('../base', () => ({
  del: vi.fn(),
  get: vi.fn(),
  patch: vi.fn(),
  post: vi.fn(),
  delPublic: vi.fn(),
  getPublic: vi.fn(),
  patchPublic: vi.fn(),
  postPublic: (...args: unknown[]) => mockPostPublic(...args),
  ssePost: vi.fn(),
  upload: (...args: unknown[]) => mockUpload(...args),
}))

vi.mock('../webapp-auth', () => ({
  getWebAppAccessToken: vi.fn(),
}))

describe('human input form upload services', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-06T00:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should fetch upload token before local file upload', async () => {
    const { uploadHumanInputFormLocalFile } = await import('../share')
    const file = new File(['content'], 'test.txt', { type: 'text/plain' })
    const onProgressCallback = vi.fn()
    const onSuccessCallback = vi.fn()
    const onErrorCallback = vi.fn()

    mockPostPublic.mockResolvedValueOnce({
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

    expect(mockPostPublic).toHaveBeenCalledWith('/form/human_input/local-form-token/upload-token')
    expect(mockUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.any(FormData),
        headers: {
          Authorization: 'bearer hitl-upload-token',
        },
      }),
      true,
      '/human-input-forms/files',
    )
    expect(onSuccessCallback).toHaveBeenCalledWith(expect.objectContaining({ id: 'file-1' }))
    expect(onErrorCallback).not.toHaveBeenCalled()
  })

  it('should fetch upload token before remote file upload', async () => {
    const { uploadHumanInputFormRemoteFileInfo } = await import('../share')

    mockPostPublic.mockResolvedValueOnce({
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

    expect(mockPostPublic).toHaveBeenCalledTimes(1)
    expect(mockPostPublic).toHaveBeenNthCalledWith(
      1,
      '/form/human_input/remote-form-token/upload-token',
    )
    expect(mockUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.any(FormData),
        headers: {
          Authorization: 'bearer hitl-remote-token',
        },
      }),
      true,
      '/human-input-forms/files',
    )
    const uploadCall = mockUpload.mock.calls[0]
    const formData = uploadCall?.[0]?.data as FormData
    expect(formData.get('url')).toBe('https://example.com/file.txt')
    expect(response).toEqual(expect.objectContaining({ id: 'remote-file-1' }))
  })
})
