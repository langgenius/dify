import type { FileEntity } from '../types'
import type { ConsoleClient } from '@/service/console'
import type { FileResponse } from '@/types/workflow'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import { TransferMethod } from '@/types/app'
import { FileAppearanceTypeEnum } from '../types'
import {
  fileIsUploaded,
  fileUpload,
  getFileAppearanceType,
  getFileExtension,
  getFilesInLogs,
  getProcessedFiles,
  getProcessedFilesFromResponse,
  getSupportFileExtensionList,
  getSupportFileType,
  isAllowedFileExtension,
} from '../utils'

const publicUpload = vi.hoisted(() =>
  vi.fn<typeof import('@/service/webapp-client').webAppClient.files.upload.post>(),
)
vi.mock('@/service/webapp-client', () => ({
  webAppClient: { files: { upload: { post: publicUpload } } },
}))
const consoleUpload = vi.hoisted(() => vi.fn<ConsoleClient['files']['upload']['post']>())
const trialUpload = vi.hoisted(() =>
  vi.fn<ConsoleClient['trialApps']['byAppId']['files']['upload']['post']>(),
)
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'files.upload.post': consoleUpload,
      'trialApps.byAppId.files.upload.post': trialUpload,
    }),
  }
})

describe('file-uploader utils', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  describe('fileUpload', () => {
    const callbacks = () => ({
      onProgressCallback: vi.fn(),
      onSuccessCallback: vi.fn(),
      onErrorCallback: vi.fn(),
    })
    const uploaded = { id: '123', name: 'test.txt', size: 4 }

    it('uploads console files through the files contract', async () => {
      const mockFile = new File(['test'], 'test.txt')
      const mockCallbacks = callbacks()
      consoleUpload.mockResolvedValue(uploaded)

      fileUpload({ file: mockFile, ...mockCallbacks })

      expect(consoleUpload).toHaveBeenCalledExactlyOnceWith(
        { body: { file: mockFile } },
        { context: { onUploadProgress: expect.any(Function) } },
      )
      expect(publicUpload).not.toHaveBeenCalled()
      await vi.waitFor(() => {
        expect(mockCallbacks.onSuccessCallback).toHaveBeenCalledExactlyOnceWith(uploaded)
        expect(mockCallbacks.onErrorCallback).not.toHaveBeenCalled()
      })
    })

    it('uploads trial app files into the trial app tenant', async () => {
      const mockFile = new File(['test'], 'test.txt')
      const mockCallbacks = callbacks()
      trialUpload.mockResolvedValue(uploaded)

      fileUpload({ file: mockFile, ...mockCallbacks }, false, 'trial-1')

      expect(trialUpload).toHaveBeenCalledExactlyOnceWith(
        { params: { app_id: 'trial-1' }, body: { file: mockFile } },
        { context: { onUploadProgress: expect.any(Function) } },
      )
      expect(consoleUpload).not.toHaveBeenCalled()
      await vi.waitFor(() =>
        expect(mockCallbacks.onSuccessCallback).toHaveBeenCalledExactlyOnceWith(uploaded),
      )
    })

    it('uploads public web app files through the WebApp files contract', async () => {
      const mockFile = new File(['test'], 'test.txt')
      const mockCallbacks = callbacks()
      publicUpload.mockResolvedValue(uploaded)

      fileUpload({ file: mockFile, ...mockCallbacks }, true)

      await vi.waitFor(() =>
        expect(mockCallbacks.onSuccessCallback).toHaveBeenCalledExactlyOnceWith(uploaded),
      )
      expect(publicUpload).toHaveBeenCalledExactlyOnceWith(
        { body: { file: mockFile } },
        { context: { onUploadProgress: expect.any(Function) } },
      )
      expect(consoleUpload).not.toHaveBeenCalled()
      publicUpload.mock.calls[0]![1]!.context!.onUploadProgress!({ loaded: 1, total: 4 })
      expect(mockCallbacks.onProgressCallback).toHaveBeenCalledWith(25)
    })

    it('should call onErrorCallback when upload fails', async () => {
      const mockCallbacks = callbacks()
      const uploadError = new Error('Upload failed')
      consoleUpload.mockRejectedValue(uploadError)

      fileUpload({ file: new File(['test'], 'test.txt'), ...mockCallbacks })

      await vi.waitFor(() => {
        expect(mockCallbacks.onErrorCallback).toHaveBeenCalledExactlyOnceWith(uploadError)
        expect(mockCallbacks.onSuccessCallback).not.toHaveBeenCalled()
      })
    })

    it('reports console upload progress as a percentage', () => {
      const mockCallbacks = callbacks()
      consoleUpload.mockResolvedValue(uploaded)

      fileUpload({ file: new File(['test'], 'test.txt'), ...mockCallbacks })
      consoleUpload.mock.calls[0]![1]!.context!.onUploadProgress!({ loaded: 50, total: 100 })

      expect(mockCallbacks.onProgressCallback).toHaveBeenCalledWith(50)
    })
  })

  describe('getFileExtension', () => {
    it('should get extension from mimetype', () => {
      expect(getFileExtension('file', 'application/pdf')).toBe('pdf')
    })

    it('should get extension from mimetype and file name', () => {
      expect(getFileExtension('file.pdf', 'application/pdf')).toBe('pdf')
    })

    it('should get extension from mimetype with multiple ext candidates with filename hint', () => {
      expect(getFileExtension('file.pem', 'application/x-x509-ca-cert')).toBe('pem')
    })

    it('should get extension from mimetype with multiple ext candidates without filename hint', () => {
      const ext = getFileExtension('file', 'application/x-x509-ca-cert')
      // mime returns Set(['der', 'crt', 'pem']), first value is used when no filename hint
      expect(['der', 'crt', 'pem']).toContain(ext)
    })

    it('should get extension from filename when mimetype is empty', () => {
      expect(getFileExtension('file.txt', '')).toBe('txt')
      expect(getFileExtension('file.txt.docx', '')).toBe('docx')
      expect(getFileExtension('file', '')).toBe('')
    })

    it('should return empty string for remote files', () => {
      expect(getFileExtension('file.txt', '', true)).toBe('')
    })

    it('should fall back to filename extension for unknown mimetype', () => {
      expect(getFileExtension('file.txt', 'application/unknown')).toBe('txt')
    })

    it('should return empty string for unknown mimetype without filename extension', () => {
      expect(getFileExtension('file', 'application/unknown')).toBe('')
    })
  })

  describe('getFileAppearanceType', () => {
    it('should identify gif files', () => {
      expect(getFileAppearanceType('image.gif', 'image/gif')).toBe(FileAppearanceTypeEnum.gif)
    })

    it('should identify image files', () => {
      expect(getFileAppearanceType('image.jpg', 'image/jpeg')).toBe(FileAppearanceTypeEnum.image)
      expect(getFileAppearanceType('image.jpeg', 'image/jpeg')).toBe(FileAppearanceTypeEnum.image)
      expect(getFileAppearanceType('image.png', 'image/png')).toBe(FileAppearanceTypeEnum.image)
      expect(getFileAppearanceType('image.webp', 'image/webp')).toBe(FileAppearanceTypeEnum.image)
      expect(getFileAppearanceType('image.svg', 'image/svg+xml')).toBe(FileAppearanceTypeEnum.image)
    })

    it('should identify video files', () => {
      expect(getFileAppearanceType('video.mp4', 'video/mp4')).toBe(FileAppearanceTypeEnum.video)
      expect(getFileAppearanceType('video.mov', 'video/quicktime')).toBe(
        FileAppearanceTypeEnum.video,
      )
      expect(getFileAppearanceType('video.mpeg', 'video/mpeg')).toBe(FileAppearanceTypeEnum.video)
      expect(getFileAppearanceType('video.webm', 'video/webm')).toBe(FileAppearanceTypeEnum.video)
    })

    it('should identify audio files', () => {
      expect(getFileAppearanceType('audio.mp3', 'audio/mpeg')).toBe(FileAppearanceTypeEnum.audio)
      expect(getFileAppearanceType('audio.m4a', 'audio/mp4')).toBe(FileAppearanceTypeEnum.audio)
      expect(getFileAppearanceType('audio.wav', 'audio/wav')).toBe(FileAppearanceTypeEnum.audio)
      expect(getFileAppearanceType('audio.amr', 'audio/AMR')).toBe(FileAppearanceTypeEnum.audio)
      expect(getFileAppearanceType('audio.mpga', 'audio/mpeg')).toBe(FileAppearanceTypeEnum.audio)
    })

    it('should identify code files', () => {
      expect(getFileAppearanceType('index.html', 'text/html')).toBe(FileAppearanceTypeEnum.code)
    })

    it('should identify PDF files', () => {
      expect(getFileAppearanceType('doc.pdf', 'application/pdf')).toBe(FileAppearanceTypeEnum.pdf)
    })

    it('should identify markdown files', () => {
      expect(getFileAppearanceType('file.md', 'text/markdown')).toBe(
        FileAppearanceTypeEnum.markdown,
      )
      expect(getFileAppearanceType('file.markdown', 'text/markdown')).toBe(
        FileAppearanceTypeEnum.markdown,
      )
      expect(getFileAppearanceType('file.mdx', 'text/mdx')).toBe(FileAppearanceTypeEnum.markdown)
    })

    it('should identify excel files', () => {
      expect(
        getFileAppearanceType(
          'doc.xlsx',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ),
      ).toBe(FileAppearanceTypeEnum.excel)
      expect(getFileAppearanceType('doc.xls', 'application/vnd.ms-excel')).toBe(
        FileAppearanceTypeEnum.excel,
      )
    })

    it('should identify word files', () => {
      expect(getFileAppearanceType('doc.doc', 'application/msword')).toBe(
        FileAppearanceTypeEnum.word,
      )
      expect(
        getFileAppearanceType(
          'doc.docx',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ),
      ).toBe(FileAppearanceTypeEnum.word)
    })

    it('should identify ppt files', () => {
      expect(getFileAppearanceType('doc.ppt', 'application/vnd.ms-powerpoint')).toBe(
        FileAppearanceTypeEnum.ppt,
      )
      expect(
        getFileAppearanceType(
          'doc.pptx',
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        ),
      ).toBe(FileAppearanceTypeEnum.ppt)
    })

    it('should identify document files', () => {
      expect(getFileAppearanceType('file.txt', 'text/plain')).toBe(FileAppearanceTypeEnum.document)
      expect(getFileAppearanceType('file.csv', 'text/csv')).toBe(FileAppearanceTypeEnum.document)
      expect(getFileAppearanceType('file.msg', 'application/vnd.ms-outlook')).toBe(
        FileAppearanceTypeEnum.document,
      )
      expect(getFileAppearanceType('file.eml', 'message/rfc822')).toBe(
        FileAppearanceTypeEnum.document,
      )
      expect(getFileAppearanceType('file.xml', 'application/xml')).toBe(
        FileAppearanceTypeEnum.document,
      )
      expect(getFileAppearanceType('file.epub', 'application/epub+zip')).toBe(
        FileAppearanceTypeEnum.document,
      )
    })

    it('should fall back to filename extension for unknown mimetype', () => {
      expect(getFileAppearanceType('file.txt', 'application/unknown')).toBe(
        FileAppearanceTypeEnum.document,
      )
    })

    it('should return custom type for unrecognized extensions', () => {
      expect(getFileAppearanceType('file.xyz', 'application/xyz')).toBe(
        FileAppearanceTypeEnum.custom,
      )
    })
  })

  describe('getSupportFileType', () => {
    it('should return custom type when isCustom is true', () => {
      expect(getSupportFileType('file.txt', '', true)).toBe(SupportUploadFileTypes.custom)
    })

    it('should return file type when isCustom is false', () => {
      expect(getSupportFileType('file.txt', 'text/plain')).toBe(SupportUploadFileTypes.document)
    })
  })

  const entity = (overrides: Partial<FileEntity> = {}): FileEntity => ({
    id: 'file-1',
    name: 'report.pdf',
    size: 1024,
    type: 'application/pdf',
    progress: 100,
    supportFileType: 'document',
    transferMethod: TransferMethod.local_file,
    uploadedId: 'upload-1',
    ...overrides,
  })
  const response = (overrides: Partial<FileResponse> = {}): FileResponse => ({
    related_id: 'file-1',
    filename: 'report.pdf',
    extension: '.pdf',
    size: 1024,
    mime_type: 'application/pdf',
    transfer_method: TransferMethod.local_file,
    type: 'document',
    url: 'https://example.com/preview',
    upload_file_id: 'upload-1',
    remote_url: '',
    ...overrides,
  })

  it('serializes local and remote files in order while excluding failed uploads', () => {
    const files = [
      entity(),
      entity({ id: 'failed', uploadedId: undefined, progress: -1 }),
      entity({
        id: 'remote',
        transferMethod: TransferMethod.remote_url,
        uploadedId: undefined,
        url: 'https://example.com/report.pdf',
      }),
    ]
    expect(getProcessedFiles(files)).toEqual([
      {
        type: 'document',
        transfer_method: TransferMethod.local_file,
        url: '',
        upload_file_id: 'upload-1',
      },
      {
        type: 'document',
        transfer_method: TransferMethod.remote_url,
        url: 'https://example.com/report.pdf',
        upload_file_id: '',
      },
    ])
  })

  it('restores file identity, metadata and preview URL from the response', () => {
    expect(getProcessedFilesFromResponse([response()])).toEqual([
      {
        id: 'file-1',
        name: 'report.pdf',
        size: 1024,
        type: 'application/pdf',
        progress: 100,
        transferMethod: TransferMethod.local_file,
        supportFileType: 'document',
        uploadedId: 'upload-1',
        url: 'https://example.com/preview',
      },
    ])
    expect(
      getProcessedFilesFromResponse([
        response({
          upload_file_id: '',
          url: '',
          remote_url: 'https://example.com/original',
          size: 0,
        }),
      ]),
    ).toEqual([
      {
        id: 'file-1',
        name: 'report.pdf',
        size: 0,
        type: 'application/pdf',
        progress: 100,
        transferMethod: TransferMethod.local_file,
        supportFileType: 'document',
        uploadedId: 'file-1',
        url: 'https://example.com/original',
      },
    ])
  })

  it.each([
    ['image.jpg', 'image/jpeg', 'document', 'image'],
    ['video.mp4', 'video/mp4', 'document', 'video'],
    ['audio.mp3', 'audio/mpeg', 'document', 'audio'],
    ['report.pdf', 'application/pdf', 'image', 'document'],
    ['report.pdf', 'image/jpeg', 'document', 'document'],
    ['image.jpg', 'image/jpeg', 'image', 'image'],
    ['', 'image/jpeg', 'document', 'document'],
    ['image.jpg', '', 'document', 'document'],
    ['file.unknown', 'application/unknown', 'document', 'document'],
  ])(
    'corrects %s only when filename and MIME agree (%s, %s -> %s)',
    (filename, mime_type, type, expected) => {
      const file = response({ filename, mime_type, type })
      expect(getProcessedFilesFromResponse([file])[0]?.supportFileType).toBe(expected)
      expect(file.type).toBe(type)
    },
  )

  it('uses custom extensions instead of standard categories and matches case-insensitively', () => {
    expect(
      getSupportFileExtensionList(
        [SupportUploadFileTypes.custom, SupportUploadFileTypes.image],
        ['.pdf', '.TxT'],
      ),
    ).toEqual(['PDF', 'TXT'])
    expect(isAllowedFileExtension('REPORT.PDF', '', ['custom', 'image'], ['.pdf'])).toBe(true)
    expect(isAllowedFileExtension('photo.jpg', 'image/jpeg', ['custom', 'image'], ['.pdf'])).toBe(
      false,
    )
    expect(getSupportFileExtensionList([], [])).toEqual([])
  })

  it('allows the combined standard categories and rejects unrelated formats', () => {
    expect(isAllowedFileExtension('image.png', 'image/png', ['image', 'document'], [])).toBe(true)
    expect(isAllowedFileExtension('report.pdf', 'application/pdf', ['image', 'document'], [])).toBe(
      true,
    )
    expect(isAllowedFileExtension('clip.mp4', 'video/mp4', ['image', 'document'], [])).toBe(false)
  })

  it('extracts only marked files from log variables, including mixed arrays', () => {
    const first = { ...response(), dify_model_identity: '__dify__file__' }
    const second = {
      ...response({ related_id: 'file-2', upload_file_id: 'upload-2', filename: 'second.pdf' }),
      dify_model_identity: '__dify__file__',
    }
    const firstEntity = {
      id: 'file-1',
      name: 'report.pdf',
      size: 1024,
      type: 'application/pdf',
      progress: 100,
      transferMethod: TransferMethod.local_file,
      supportFileType: 'document',
      uploadedId: 'upload-1',
      url: 'https://example.com/preview',
    }
    const secondEntity = {
      ...firstEntity,
      id: 'file-2',
      uploadedId: 'upload-2',
      name: 'second.pdf',
    }
    expect(
      getFilesInLogs({
        single: first,
        mixed: [null, { notAFile: true }, second, 'text', first],
        number: 1,
        object: { key: 'value' },
        array: [null, 1, 'text'],
        empty: [],
      }),
    ).toEqual([
      { varName: 'single', list: [firstEntity] },
      { varName: 'mixed', list: [secondEntity, firstEntity] },
    ])
    expect(getFilesInLogs(null)).toEqual([])
    expect(getFilesInLogs(undefined)).toEqual([])
  })

  it.each([
    [{ uploadedId: 'upload-1' }, true],
    [{ uploadedId: undefined, transferMethod: TransferMethod.remote_url, progress: 100 }, true],
    [{ uploadedId: undefined, transferMethod: TransferMethod.remote_url, progress: 50 }, false],
    [{ uploadedId: undefined, transferMethod: TransferMethod.local_file, progress: 100 }, false],
    [{ uploadedId: undefined, progress: -1 }, false],
  ] satisfies [Partial<FileEntity>, boolean][])(
    'recognizes only usable uploaded files: %j',
    (overrides, uploaded) => {
      expect(Boolean(fileIsUploaded(entity(overrides)))).toBe(uploaded)
    },
  )
})
