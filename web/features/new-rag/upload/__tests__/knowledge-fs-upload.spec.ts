import type { KnowledgeFsUploadProgress } from '../knowledge-fs-upload'
import { ORPCError } from '@orpc/client'
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

vi.mock('@/service/console', () => ({
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

function scanRejection(code: string, details: Record<string, unknown> = {}) {
  return new ORPCError(code, {
    status: 422,
    message: 'rejected by the malware scan',
    data: {
      code,
      message: 'rejected by the malware scan',
      status: 422,
      details: { code, ...details },
    },
  })
}

function stagedUploads(...names: string[]) {
  return names.map((name) => ({
    file: new File([name], name, { type: 'text/plain' }),
    id: `upload-${name}`,
    uploadId: `staged-${name}`,
  }))
}

const claimedUploadIds = () =>
  serviceMock.uploadDocument.mock.calls.map(([call]) => call.body.upload_id)

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
    expect(serviceMock.discardUpload).toHaveBeenCalledWith(
      { params: { upload_id: 'staged-upload-1' } },
      { context: { silent: true } },
    )
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
    await expect(uploadKnowledgeFsDocuments('control-space-1', uploads, progress)).resolves.toEqual(
      {
        failures: [],
      },
    )

    expect(serviceMock.uploadDocument.mock.calls.map(([call]) => call.body.upload_id)).toEqual([
      'staged-a',
      'staged-b',
      'staged-b',
    ])
  })
})

describe('uploadKnowledgeFsDocuments malware scan', () => {
  beforeEach(() => {
    serviceMock.uploadDocument.mockReset()
    serviceMock.uploadDocument.mockResolvedValue({ logical_document_id: 'document-1' })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('records a scan rejection for its file and still claims the remaining files', async () => {
    serviceMock.uploadDocument
      .mockResolvedValueOnce({ logical_document_id: 'document-a' })
      .mockRejectedValueOnce(
        scanRejection('file_scan_malware_detected', {
          file_name: 'b.txt',
          provider_name: 'Office scanner',
          retryable: false,
          threats: ['Eicar-Test-Signature'],
        }),
      )
      .mockResolvedValueOnce({ logical_document_id: 'document-c' })
    const uploads = stagedUploads('a.txt', 'b.txt', 'c.txt')
    const progress: KnowledgeFsUploadProgress = new Map()
    const onProgress = vi.fn()

    const result = await uploadKnowledgeFsDocuments('space-1', uploads, progress, onProgress)

    expect(claimedUploadIds()).toEqual(['staged-a.txt', 'staged-b.txt', 'staged-c.txt'])
    expect(result.failures).toEqual([
      {
        upload: uploads[1],
        failure: {
          code: 'file_scan_malware_detected',
          fileName: 'b.txt',
          problem: undefined,
          providerName: 'Office scanner',
          retryable: false,
          threats: ['Eicar-Test-Signature'],
        },
      },
    ])
    expect(onProgress.mock.calls.map(([file, phase]) => [file.name, phase])).toEqual([
      ['a.txt', 'pending'],
      ['a.txt', 'completed'],
      ['b.txt', 'pending'],
      ['b.txt', 'failed'],
      ['c.txt', 'pending'],
      ['c.txt', 'completed'],
    ])
    expect(progress.get('upload-b.txt')?.phase).toBe('failed')
  })

  it('claims a retryable rejection again but never a final one', async () => {
    serviceMock.uploadDocument
      .mockRejectedValueOnce(scanRejection('file_scan_malware_detected', { retryable: false }))
      .mockRejectedValueOnce(scanRejection('file_scan_unavailable', { retryable: true }))
      .mockResolvedValueOnce({ logical_document_id: 'document-b' })
    const uploads = stagedUploads('a.txt', 'b.txt')
    const progress: KnowledgeFsUploadProgress = new Map()

    const first = await uploadKnowledgeFsDocuments('space-1', uploads, progress)
    const second = await uploadKnowledgeFsDocuments('space-1', uploads, progress)

    expect(first.failures.map(({ failure }) => failure.code)).toEqual([
      'file_scan_malware_detected',
      'file_scan_unavailable',
    ])
    // The blocked file was deleted by the backend, so only the retryable one is claimed again.
    expect(claimedUploadIds()).toEqual(['staged-a.txt', 'staged-b.txt', 'staged-b.txt'])
    expect(second.failures.map(({ upload }) => upload.file.name)).toEqual(['a.txt'])
    expect(progress.get('upload-b.txt')?.phase).toBe('completed')
  })

  it('still aborts the batch for an error that is not a scan rejection', async () => {
    serviceMock.uploadDocument.mockRejectedValueOnce(
      new ORPCError('invalid_param', { status: 422, data: { code: 'invalid_param' } }),
    )
    const uploads = stagedUploads('a.txt', 'b.txt')

    await expect(uploadKnowledgeFsDocuments('space-1', uploads)).rejects.toMatchObject({
      code: 'invalid_param',
    })
    expect(claimedUploadIds()).toEqual(['staged-a.txt'])
  })

  it('repeats the same claim every three seconds while the scanner is still working', async () => {
    vi.useFakeTimers()
    serviceMock.uploadDocument
      .mockRejectedValueOnce(scanRejection('file_scan_pending', { retryable: true }))
      .mockRejectedValueOnce(scanRejection('file_scan_pending', { retryable: true }))
      .mockResolvedValueOnce({ logical_document_id: 'document-a' })
    const uploads = stagedUploads('a.txt')
    const onProgress = vi.fn()

    const upload = uploadKnowledgeFsDocuments('space-1', uploads, new Map(), onProgress)
    await vi.advanceTimersByTimeAsync(2_999)
    expect(serviceMock.uploadDocument).toHaveBeenCalledTimes(1)
    expect(onProgress.mock.calls.map(([, phase]) => phase)).toEqual(['pending', 'scanning'])

    await vi.advanceTimersByTimeAsync(1)
    expect(serviceMock.uploadDocument).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(3_000)

    await expect(upload).resolves.toEqual({ failures: [] })
    expect(claimedUploadIds()).toEqual(['staged-a.txt', 'staged-a.txt', 'staged-a.txt'])
    expect(onProgress.mock.calls.at(-1)).toEqual([uploads[0]!.file, 'completed'])
  })

  it('stops waiting after forty retries and leaves the file retryable', async () => {
    vi.useFakeTimers()
    const uploads = stagedUploads('a.txt', 'b.txt')
    serviceMock.uploadDocument.mockImplementation(async ({ body }) => {
      if (body.upload_id === 'staged-b.txt') return { logical_document_id: 'document-b' }
      throw scanRejection('file_scan_pending', { retryable: false })
    })

    const upload = uploadKnowledgeFsDocuments('space-1', uploads)
    await vi.advanceTimersByTimeAsync(40 * 3_000)
    const result = await upload

    expect(claimedUploadIds().filter((id) => id === 'staged-a.txt')).toHaveLength(41)
    expect(result.failures).toEqual([
      {
        upload: uploads[0],
        failure: expect.objectContaining({ code: 'file_scan_pending', retryable: true }),
      },
    ])
    expect(claimedUploadIds().at(-1)).toBe('staged-b.txt')
  })
})
