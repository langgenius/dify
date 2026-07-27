import { uploadKnowledgeFsDocuments } from '../knowledge-fs-upload'

const serviceMock = vi.hoisted(() => ({
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
    },
  },
}))

describe('uploadKnowledgeFsDocuments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    serviceMock.uploadDocument.mockResolvedValue({ logical_document_id: 'document-1' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uploads every file through the generated Dify API contract', async () => {
    const directRequest = vi.spyOn(globalThis, 'fetch')
    const files = [
      new File(['one'], 'one.md', { type: 'text/markdown' }),
      new File(['two'], 'two.txt', { type: 'text/plain' }),
    ]

    await uploadKnowledgeFsDocuments(
      'control-space-1',
      files.map((file, index) => ({ file, id: `upload-${index}` })),
    )

    expect(serviceMock.uploadDocument.mock.calls).toEqual([
      [
        {
          body: { file: files[0] },
          params: { control_space_id: 'control-space-1' },
        },
      ],
      [
        {
          body: { file: files[1] },
          params: { control_space_id: 'control-space-1' },
        },
      ],
    ])
    expect(directRequest).not.toHaveBeenCalled()
  })

  it('resumes at the failed file after a partial multi-file upload', async () => {
    serviceMock.uploadDocument
      .mockResolvedValueOnce({ logical_document_id: 'document-a' })
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce({ logical_document_id: 'document-b' })
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

    expect(serviceMock.uploadDocument.mock.calls.map(([call]) => call.body.file.name)).toEqual([
      'a.txt',
      'b.txt',
      'b.txt',
    ])
  })
})
