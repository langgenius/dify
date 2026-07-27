import { uploadKnowledgeFsDocuments } from '../knowledge-fs-upload'

const serviceMock = vi.hoisted(() => ({
  getSpace: vi.fn(),
  issueCapability: vi.fn(),
  smallFile: vi.fn(),
}))

vi.mock('@/service/client', () => ({
  consoleClient: {
    knowledgeFs: {
      spaces: {
        byControlSpaceId: {
          get: serviceMock.getSpace,
          uploadCapabilities: {
            post: serviceMock.issueCapability,
          },
          uploadSessions: {
            byUploadSessionId: {
              smallFile: {
                post: serviceMock.smallFile,
              },
            },
          },
        },
      },
    },
  },
}))

describe('uploadKnowledgeFsDocuments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    serviceMock.getSpace.mockResolvedValue({
      knowledge_space_id: 'physical-space-1',
      state: 'active',
    })
    serviceMock.issueCapability.mockResolvedValue({
      direct_origin: 'https://knowledge-fs.example',
      expires_at: '2026-07-27T12:00:00Z',
      operation_id: 'createUploadSession',
      token: 'capability-token',
    })
    serviceMock.smallFile.mockResolvedValue({
      session: { id: 'session-1', mode: 'small_fallback', status: 'completed' },
    })
    vi.spyOn(globalThis.crypto.subtle, 'digest').mockResolvedValue(new Uint8Array(32).buffer)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('creates a capability-bound session and uses the Dify small-file fallback', async () => {
    const request = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          session: {
            id: 'session-1',
            mode: 'small_fallback',
            status: 'ready',
          },
        }),
        {
          status: 201,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )
    vi.stubGlobal('fetch', request)
    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' })

    await uploadKnowledgeFsDocuments('control-space-1', [{ file, id: 'upload-1' }])

    expect(serviceMock.issueCapability).toHaveBeenCalledWith({
      body: { operation_id: 'createUploadSession' },
      params: { control_space_id: 'control-space-1' },
    })
    expect(request).toHaveBeenCalledWith(
      'https://knowledge-fs.example/knowledge-spaces/physical-space-1/upload-sessions',
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer capability-token',
          'Content-Type': 'application/json',
        },
        method: 'POST',
      }),
    )
    expect(serviceMock.smallFile).toHaveBeenCalledWith({
      body: { file },
      params: {
        control_space_id: 'control-space-1',
        upload_session_id: 'session-1',
      },
    })
  })

  it('resumes only the failed file after a partial multi-file upload', async () => {
    const request = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { fileName: string }
      const sessionId = body.fileName === 'a.txt' ? 'session-a' : 'session-b'
      return new Response(
        JSON.stringify({
          session: {
            id: sessionId,
            mode: 'small_fallback',
            status: 'ready',
          },
        }),
        {
          status: 201,
          headers: { 'content-type': 'application/json' },
        },
      )
    })
    vi.stubGlobal('fetch', request)
    serviceMock.smallFile.mockImplementation(
      ({ params }: { params: { upload_session_id: string } }) => {
        if (
          params.upload_session_id === 'session-b' &&
          serviceMock.smallFile.mock.calls.filter(
            ([call]) => call.params.upload_session_id === 'session-b',
          ).length === 1
        )
          return Promise.reject(new Error('response lost'))
        return Promise.resolve({
          session: {
            id: params.upload_session_id,
            mode: 'small_fallback',
            status: 'completed',
          },
        })
      },
    )
    const uploads = [
      { file: new File(['a'], 'a.txt', { type: 'text/plain' }), id: 'upload-a' },
      { file: new File(['b'], 'b.txt', { type: 'text/plain' }), id: 'upload-b' },
    ]
    const progress = new Map()

    await expect(uploadKnowledgeFsDocuments('control-space-1', uploads, progress)).rejects.toThrow(
      'response lost',
    )
    await expect(
      uploadKnowledgeFsDocuments('control-space-1', uploads, progress),
    ).resolves.toBeUndefined()

    expect(request).toHaveBeenCalledTimes(2)
    expect(serviceMock.smallFile.mock.calls.map(([call]) => call.params.upload_session_id)).toEqual(
      ['session-a', 'session-b', 'session-b'],
    )
  })
})
