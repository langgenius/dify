import {
  discardKnowledgeFsStagedUpload,
  stageKnowledgeFsDocument,
  uploadKnowledgeFsDocuments,
} from '../knowledge-fs-upload'

const serviceMock = vi.hoisted(() => ({
  discardUpload: vi.fn(),
  stageUpload: vi.fn(),
  uploadDocument: vi.fn(),
}))

vi.mock('@/service/client', () => ({
  consoleClient: {
    knowledgeFs: {
      spaces: {
        byControlSpaceId: {
          documents: {
            post: serviceMock.uploadDocument,
          },
        },
      },
      uploads: {
        byUploadId: {
          delete: serviceMock.discardUpload,
        },
        post: serviceMock.stageUpload,
      },
    },
  },
}))

describe('uploadKnowledgeFsDocuments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    serviceMock.discardUpload.mockResolvedValue(undefined)
    serviceMock.stageUpload.mockResolvedValue({ id: 'staged-upload-1' })
    serviceMock.uploadDocument.mockResolvedValue({ logical_document_id: 'document-1' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('stages and discards files through the generated Dify API contract', async () => {
    const file = new File(['one'], 'one.md', { type: 'text/markdown' })
    const controller = new AbortController()

    await expect(stageKnowledgeFsDocument(file, controller.signal)).resolves.toBe('staged-upload-1')
    await discardKnowledgeFsStagedUpload('staged-upload-1')

    expect(serviceMock.stageUpload).toHaveBeenCalledWith(
      { body: { file } },
      { context: { silent: true }, signal: controller.signal },
    )
    expect(serviceMock.discardUpload).toHaveBeenCalledWith({
      params: { upload_id: 'staged-upload-1' },
    })
  })

  it('claims every staged file through the generated Dify API contract', async () => {
    const directRequest = vi.spyOn(globalThis, 'fetch')
    const onProgress = vi.fn()
    const files = [
      new File(['one'], 'one.md', { type: 'text/markdown' }),
      new File(['two'], 'two.txt', { type: 'text/plain' }),
    ]

    await uploadKnowledgeFsDocuments(
      'control-space-1',
      files.map((file, index) => ({
        file,
        id: `upload-${index}`,
        uploadId: `staged-upload-${index}`,
      })),
      new Map(),
      onProgress,
    )

    expect(serviceMock.uploadDocument.mock.calls).toEqual([
      [
        {
          body: { upload_id: 'staged-upload-0' },
          params: { control_space_id: 'control-space-1' },
        },
        { context: { silent: true } },
      ],
      [
        {
          body: { upload_id: 'staged-upload-1' },
          params: { control_space_id: 'control-space-1' },
        },
        { context: { silent: true } },
      ],
    ])
    expect(onProgress.mock.calls).toEqual([
      [files[0], 'pending'],
      [files[0], 'completed'],
      [files[1], 'pending'],
      [files[1], 'completed'],
    ])
    expect(directRequest).not.toHaveBeenCalled()
  })

  it('resumes at the failed file after a partial multi-file upload', async () => {
    serviceMock.uploadDocument
      .mockResolvedValueOnce({ logical_document_id: 'document-a' })
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce({ logical_document_id: 'document-b' })
    const uploads = [
      {
        file: new File(['a'], 'a.txt', { type: 'text/plain' }),
        id: 'upload-a',
        uploadId: 'staged-a',
      },
      {
        file: new File(['b'], 'b.txt', { type: 'text/plain' }),
        id: 'upload-b',
        uploadId: 'staged-b',
      },
    ]
    const progress = new Map()

    await expect(uploadKnowledgeFsDocuments('control-space-1', uploads, progress)).rejects.toThrow(
      'response lost',
    )
    await expect(
      uploadKnowledgeFsDocuments('control-space-1', uploads, progress),
    ).resolves.toBeUndefined()

    expect(serviceMock.uploadDocument.mock.calls.map(([call]) => call.body.upload_id)).toEqual([
      'staged-a',
      'staged-b',
      'staged-b',
    ])
  })
})
