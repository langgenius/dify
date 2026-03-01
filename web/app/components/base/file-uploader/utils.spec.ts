import type { FileEntity } from './types'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import { upload } from '@/service/base'
import { TransferMethod } from '@/types/app'
import { FILE_EXTS } from '../prompt-editor/constants'
import { FileAppearanceTypeEnum } from './types'
import {
  fileIsUploaded,
  fileUpload,
  getFileAppearanceType,
  getFileExtension,
  getFileNameFromUrl,
  getFilesInLogs,
  getFileUploadErrorMessage,
  getProcessedFiles,
  getProcessedFilesFromResponse,
  getSupportFileExtensionList,
  getSupportFileType,
  isAllowedFileExtension,
} from './utils'

vi.mock('@/service/base', () => ({
  upload: vi.fn(),
}))

describe('file-uploader utils', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  describe('getFileUploadErrorMessage', () => {
    const createMockT = () => vi.fn().mockImplementation((key: string) => key) as unknown as import('i18next').TFunction

    it('should return forbidden message when error code is forbidden', () => {
      const error = { response: { code: 'forbidden', message: 'Access denied' } }
      expect(getFileUploadErrorMessage(error, 'default', createMockT())).toBe('Access denied')
    })

    it('should return file_extension_blocked translation when error code matches', () => {
      const error = { response: { code: 'file_extension_blocked' } }
      expect(getFileUploadErrorMessage(error, 'default', createMockT())).toBe('fileUploader.fileExtensionBlocked')
    })

    it('should return default message for other errors', () => {
      const error = { response: { code: 'unknown_error' } }
      expect(getFileUploadErrorMessage(error, 'Upload failed', createMockT())).toBe('Upload failed')
    })

    it('should return default message when error has no response', () => {
      expect(getFileUploadErrorMessage(null, 'Upload failed', createMockT())).toBe('Upload failed')
    })
  })

  describe('fileUpload', () => {
    it('should handle successful file upload', async () => {
      const mockFile = new File(['test'], 'test.txt')
      const mockCallbacks = {
        onProgressCallback: vi.fn(),
        onSuccessCallback: vi.fn(),
        onErrorCallback: vi.fn(),
      }

      vi.mocked(upload).mockResolvedValue({ id: '123' })

      fileUpload({
        file: mockFile,
        ...mockCallbacks,
      })

      expect(upload).toHaveBeenCalled()

      // Wait for the promise to resolve and call onSuccessCallback
      await vi.waitFor(() => {
        expect(mockCallbacks.onSuccessCallback).toHaveBeenCalledWith({ id: '123' })
      })
    })

    it('should call onErrorCallback when upload fails', async () => {
      const mockFile = new File(['test'], 'test.txt')
      const mockCallbacks = {
        onProgressCallback: vi.fn(),
        onSuccessCallback: vi.fn(),
        onErrorCallback: vi.fn(),
      }

      const uploadError = new Error('Upload failed')
      vi.mocked(upload).mockRejectedValue(uploadError)

      fileUpload({
        file: mockFile,
        ...mockCallbacks,
      })

      await vi.waitFor(() => {
        expect(mockCallbacks.onErrorCallback).toHaveBeenCalledWith(uploadError)
      })
    })

    it('should call onProgressCallback when progress event is computable', () => {
      const mockFile = new File(['test'], 'test.txt')
      const mockCallbacks = {
        onProgressCallback: vi.fn(),
        onSuccessCallback: vi.fn(),
        onErrorCallback: vi.fn(),
      }

      vi.mocked(upload).mockImplementation(({ onprogress }) => {
        // Simulate a progress event
        if (onprogress)
          onprogress.call({} as XMLHttpRequest, { lengthComputable: true, loaded: 50, total: 100 } as ProgressEvent)

        return Promise.resolve({ id: '123' })
      })

      fileUpload({
        file: mockFile,
        ...mockCallbacks,
      })

      expect(mockCallbacks.onProgressCallback).toHaveBeenCalledWith(50)
    })

    it('should not call onProgressCallback when progress event is not computable', () => {
      const mockFile = new File(['test'], 'test.txt')
      const mockCallbacks = {
        onProgressCallback: vi.fn(),
        onSuccessCallback: vi.fn(),
        onErrorCallback: vi.fn(),
      }

      vi.mocked(upload).mockImplementation(({ onprogress }) => {
        if (onprogress)
          onprogress.call({} as XMLHttpRequest, { lengthComputable: false, loaded: 0, total: 0 } as ProgressEvent)

        return Promise.resolve({ id: '123' })
      })

      fileUpload({
        file: mockFile,
        ...mockCallbacks,
      })

      expect(mockCallbacks.onProgressCallback).not.toHaveBeenCalled()
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
      expect(getFileAppearanceType('image.gif', 'image/gif'))
        .toBe(FileAppearanceTypeEnum.gif)
    })

    it('should identify image files', () => {
      expect(getFileAppearanceType('image.jpg', 'image/jpeg'))
        .toBe(FileAppearanceTypeEnum.image)
      expect(getFileAppearanceType('image.jpeg', 'image/jpeg'))
        .toBe(FileAppearanceTypeEnum.image)
      expect(getFileAppearanceType('image.png', 'image/png'))
        .toBe(FileAppearanceTypeEnum.image)
      expect(getFileAppearanceType('image.webp', 'image/webp'))
        .toBe(FileAppearanceTypeEnum.image)
      expect(getFileAppearanceType('image.svg', 'image/svg+xml'))
        .toBe(FileAppearanceTypeEnum.image)
    })

    it('should identify video files', () => {
      expect(getFileAppearanceType('video.mp4', 'video/mp4'))
        .toBe(FileAppearanceTypeEnum.video)
      expect(getFileAppearanceType('video.mov', 'video/quicktime'))
        .toBe(FileAppearanceTypeEnum.video)
      expect(getFileAppearanceType('video.mpeg', 'video/mpeg'))
        .toBe(FileAppearanceTypeEnum.video)
      expect(getFileAppearanceType('video.webm', 'video/webm'))
        .toBe(FileAppearanceTypeEnum.video)
    })

    it('should identify audio files', () => {
      expect(getFileAppearanceType('audio.mp3', 'audio/mpeg'))
        .toBe(FileAppearanceTypeEnum.audio)
      expect(getFileAppearanceType('audio.m4a', 'audio/mp4'))
        .toBe(FileAppearanceTypeEnum.audio)
      expect(getFileAppearanceType('audio.wav', 'audio/wav'))
        .toBe(FileAppearanceTypeEnum.audio)
      expect(getFileAppearanceType('audio.amr', 'audio/AMR'))
        .toBe(FileAppearanceTypeEnum.audio)
      expect(getFileAppearanceType('audio.mpga', 'audio/mpeg'))
        .toBe(FileAppearanceTypeEnum.audio)
    })

    it('should identify code files', () => {
      expect(getFileAppearanceType('index.html', 'text/html'))
        .toBe(FileAppearanceTypeEnum.code)
    })

    it('should identify PDF files', () => {
      expect(getFileAppearanceType('doc.pdf', 'application/pdf'))
        .toBe(FileAppearanceTypeEnum.pdf)
    })

    it('should identify markdown files', () => {
      expect(getFileAppearanceType('file.md', 'text/markdown'))
        .toBe(FileAppearanceTypeEnum.markdown)
      expect(getFileAppearanceType('file.markdown', 'text/markdown'))
        .toBe(FileAppearanceTypeEnum.markdown)
      expect(getFileAppearanceType('file.mdx', 'text/mdx'))
        .toBe(FileAppearanceTypeEnum.markdown)
    })

    it('should identify excel files', () => {
      expect(getFileAppearanceType('doc.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'))
        .toBe(FileAppearanceTypeEnum.excel)
      expect(getFileAppearanceType('doc.xls', 'application/vnd.ms-excel'))
        .toBe(FileAppearanceTypeEnum.excel)
    })

    it('should identify word files', () => {
      expect(getFileAppearanceType('doc.doc', 'application/msword'))
        .toBe(FileAppearanceTypeEnum.word)
      expect(getFileAppearanceType('doc.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'))
        .toBe(FileAppearanceTypeEnum.word)
    })

    it('should identify ppt files', () => {
      expect(getFileAppearanceType('doc.ppt', 'application/vnd.ms-powerpoint'))
        .toBe(FileAppearanceTypeEnum.ppt)
      expect(getFileAppearanceType('doc.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'))
        .toBe(FileAppearanceTypeEnum.ppt)
    })

    it('should identify document files', () => {
      expect(getFileAppearanceType('file.txt', 'text/plain'))
        .toBe(FileAppearanceTypeEnum.document)
      expect(getFileAppearanceType('file.csv', 'text/csv'))
        .toBe(FileAppearanceTypeEnum.document)
      expect(getFileAppearanceType('file.msg', 'application/vnd.ms-outlook'))
        .toBe(FileAppearanceTypeEnum.document)
      expect(getFileAppearanceType('file.eml', 'message/rfc822'))
        .toBe(FileAppearanceTypeEnum.document)
      expect(getFileAppearanceType('file.xml', 'application/xml'))
        .toBe(FileAppearanceTypeEnum.document)
      expect(getFileAppearanceType('file.epub', 'application/epub+zip'))
        .toBe(FileAppearanceTypeEnum.document)
    })

    it('should fall back to filename extension for unknown mimetype', () => {
      expect(getFileAppearanceType('file.txt', 'application/unknown'))
        .toBe(FileAppearanceTypeEnum.document)
    })

    it('should return custom type for unrecognized extensions', () => {
      expect(getFileAppearanceType('file.xyz', 'application/xyz'))
        .toBe(FileAppearanceTypeEnum.custom)
    })
  })

  describe('getSupportFileType', () => {
    it('should return custom type when isCustom is true', () => {
      expect(getSupportFileType('file.txt', '', true))
        .toBe(SupportUploadFileTypes.custom)
    })

    it('should return file type when isCustom is false', () => {
      expect(getSupportFileType('file.txt', 'text/plain'))
        .toBe(SupportUploadFileTypes.document)
    })
  })

  describe('getProcessedFiles', () => {
    it('should process files correctly', () => {
      const files = [{
        id: '123',
        name: 'test.txt',
        size: 1024,
        type: 'text/plain',
        progress: 100,
        supportFileType: 'document',
        transferMethod: TransferMethod.remote_url,
        url: 'http://example.com',
        uploadedId: '123',
      }]

      const result = getProcessedFiles(files)
      expect(result[0]).toEqual({
        type: 'document',
        transfer_method: TransferMethod.remote_url,
        url: 'http://example.com',
        upload_file_id: '123',
      })
    })

    it('should fallback to empty string when url is missing', () => {
      const files = [{
        id: '123',
        name: 'test.txt',
        size: 1024,
        type: 'text/plain',
        progress: 100,
        supportFileType: 'document',
        transferMethod: TransferMethod.local_file,
        url: undefined,
        uploadedId: '123',
      }] as unknown as FileEntity[]

      const result = getProcessedFiles(files)
      expect(result[0].url).toBe('')
    })

    it('should fallback to empty string when uploadedId is missing', () => {
      const files = [{
        id: '123',
        name: 'test.txt',
        size: 1024,
        type: 'text/plain',
        progress: 100,
        supportFileType: 'document',
        transferMethod: TransferMethod.local_file,
        url: 'http://example.com',
        uploadedId: undefined,
      }] as unknown as FileEntity[]

      const result = getProcessedFiles(files)
      expect(result[0].upload_file_id).toBe('')
    })

    it('should filter out files with progress -1', () => {
      const files = [
        {
          id: '1',
          name: 'good.txt',
          progress: 100,
          supportFileType: 'document',
          transferMethod: TransferMethod.local_file,
          url: 'http://example.com',
          uploadedId: '1',
        },
        {
          id: '2',
          name: 'bad.txt',
          progress: -1,
          supportFileType: 'document',
          transferMethod: TransferMethod.local_file,
          url: 'http://example.com',
          uploadedId: '2',
        },
      ] as unknown as FileEntity[]

      const result = getProcessedFiles(files)
      expect(result).toHaveLength(1)
      expect(result[0].upload_file_id).toBe('1')
    })
  })

  describe('getProcessedFilesFromResponse', () => {
    it('should process files correctly without type correction', () => {
      const files = [{
        related_id: '2a38e2ca-1295-415d-a51d-65d4ff9912d9',
        extension: '.jpeg',
        filename: 'test.jpeg',
        size: 2881761,
        mime_type: 'image/jpeg',
        transfer_method: TransferMethod.local_file,
        type: 'image',
        url: 'https://upload.dify.dev/files/xxx/file-preview',
        upload_file_id: '2a38e2ca-1295-415d-a51d-65d4ff9912d9',
        remote_url: '',
      }]

      const result = getProcessedFilesFromResponse(files)
      expect(result[0]).toEqual({
        id: '2a38e2ca-1295-415d-a51d-65d4ff9912d9',
        name: 'test.jpeg',
        size: 2881761,
        type: 'image/jpeg',
        progress: 100,
        transferMethod: TransferMethod.local_file,
        supportFileType: 'image',
        uploadedId: '2a38e2ca-1295-415d-a51d-65d4ff9912d9',
        url: 'https://upload.dify.dev/files/xxx/file-preview',
      })
    })

    it('should correct image file misclassified as document', () => {
      const files = [{
        related_id: '123',
        extension: '.jpg',
        filename: 'image.jpg',
        size: 1024,
        mime_type: 'image/jpeg',
        transfer_method: TransferMethod.local_file,
        type: 'document',
        url: 'https://example.com/image.jpg',
        upload_file_id: '123',
        remote_url: '',
      }]

      const result = getProcessedFilesFromResponse(files)
      expect(result[0].supportFileType).toBe('image')
    })

    it('should correct video file misclassified as document', () => {
      const files = [{
        related_id: '123',
        extension: '.mp4',
        filename: 'video.mp4',
        size: 1024,
        mime_type: 'video/mp4',
        transfer_method: TransferMethod.local_file,
        type: 'document',
        url: 'https://example.com/video.mp4',
        upload_file_id: '123',
        remote_url: '',
      }]

      const result = getProcessedFilesFromResponse(files)
      expect(result[0].supportFileType).toBe('video')
    })

    it('should correct audio file misclassified as document', () => {
      const files = [{
        related_id: '123',
        extension: '.mp3',
        filename: 'audio.mp3',
        size: 1024,
        mime_type: 'audio/mpeg',
        transfer_method: TransferMethod.local_file,
        type: 'document',
        url: 'https://example.com/audio.mp3',
        upload_file_id: '123',
        remote_url: '',
      }]

      const result = getProcessedFilesFromResponse(files)
      expect(result[0].supportFileType).toBe('audio')
    })

    it('should correct document file misclassified as image', () => {
      const files = [{
        related_id: '123',
        extension: '.pdf',
        filename: 'document.pdf',
        size: 1024,
        mime_type: 'application/pdf',
        transfer_method: TransferMethod.local_file,
        type: 'image',
        url: 'https://example.com/document.pdf',
        upload_file_id: '123',
        remote_url: '',
      }]

      const result = getProcessedFilesFromResponse(files)
      expect(result[0].supportFileType).toBe('document')
    })

    it('should NOT correct when filename and MIME type conflict', () => {
      const files = [{
        related_id: '123',
        extension: '.pdf',
        filename: 'document.pdf',
        size: 1024,
        mime_type: 'image/jpeg',
        transfer_method: TransferMethod.local_file,
        type: 'document',
        url: 'https://example.com/document.pdf',
        upload_file_id: '123',
        remote_url: '',
      }]

      const result = getProcessedFilesFromResponse(files)
      expect(result[0].supportFileType).toBe('document')
    })

    it('should NOT correct when filename and MIME type both point to same type', () => {
      const files = [{
        related_id: '123',
        extension: '.jpg',
        filename: 'image.jpg',
        size: 1024,
        mime_type: 'image/jpeg',
        transfer_method: TransferMethod.local_file,
        type: 'image',
        url: 'https://example.com/image.jpg',
        upload_file_id: '123',
        remote_url: '',
      }]

      const result = getProcessedFilesFromResponse(files)
      expect(result[0].supportFileType).toBe('image')
    })

    it('should handle files with missing filename', () => {
      const files = [{
        related_id: '123',
        extension: '',
        filename: '',
        size: 1024,
        mime_type: 'image/jpeg',
        transfer_method: TransferMethod.local_file,
        type: 'document',
        url: 'https://example.com/file',
        upload_file_id: '123',
        remote_url: '',
      }]

      const result = getProcessedFilesFromResponse(files)
      expect(result[0].supportFileType).toBe('document')
    })

    it('should handle files with missing MIME type', () => {
      const files = [{
        related_id: '123',
        extension: '.jpg',
        filename: 'image.jpg',
        size: 1024,
        mime_type: '',
        transfer_method: TransferMethod.local_file,
        type: 'document',
        url: 'https://example.com/image.jpg',
        upload_file_id: '123',
        remote_url: '',
      }]

      const result = getProcessedFilesFromResponse(files)
      expect(result[0].supportFileType).toBe('document')
    })

    it('should handle files with unknown extensions', () => {
      const files = [{
        related_id: '123',
        extension: '.unknown',
        filename: 'file.unknown',
        size: 1024,
        mime_type: 'application/unknown',
        transfer_method: TransferMethod.local_file,
        type: 'document',
        url: 'https://example.com/file.unknown',
        upload_file_id: '123',
        remote_url: '',
      }]

      const result = getProcessedFilesFromResponse(files)
      expect(result[0].supportFileType).toBe('document')
    })

    it('should handle multiple different file types correctly', () => {
      const files = [
        {
          related_id: '1',
          extension: '.jpg',
          filename: 'correct-image.jpg',
          mime_type: 'image/jpeg',
          type: 'image',
          size: 1024,
          transfer_method: TransferMethod.local_file,
          url: 'https://example.com/correct-image.jpg',
          upload_file_id: '1',
          remote_url: '',
        },
        {
          related_id: '2',
          extension: '.png',
          filename: 'misclassified-image.png',
          mime_type: 'image/png',
          type: 'document',
          size: 2048,
          transfer_method: TransferMethod.local_file,
          url: 'https://example.com/misclassified-image.png',
          upload_file_id: '2',
          remote_url: '',
        },
        {
          related_id: '3',
          extension: '.pdf',
          filename: 'conflicted.pdf',
          mime_type: 'image/jpeg',
          type: 'document',
          size: 3072,
          transfer_method: TransferMethod.local_file,
          url: 'https://example.com/conflicted.pdf',
          upload_file_id: '3',
          remote_url: '',
        },
      ]

      const result = getProcessedFilesFromResponse(files)

      expect(result[0].supportFileType).toBe('image') // correct, no change
      expect(result[1].supportFileType).toBe('image') // corrected from document to image
      expect(result[2].supportFileType).toBe('document') // conflict, no change
    })
  })

  describe('getFileNameFromUrl', () => {
    it('should extract filename from URL', () => {
      expect(getFileNameFromUrl('http://example.com/path/file.txt'))
        .toBe('file.txt')
    })

    it('should return empty string for URL ending with slash', () => {
      expect(getFileNameFromUrl('http://example.com/path/'))
        .toBe('')
    })
  })

  describe('getSupportFileExtensionList', () => {
    it('should handle custom file types', () => {
      const result = getSupportFileExtensionList(
        [SupportUploadFileTypes.custom],
        ['.pdf', '.txt', '.doc'],
      )
      expect(result).toEqual(['PDF', 'TXT', 'DOC'])
    })

    it('should handle standard file types', () => {
      const mockFileExts = {
        image: ['JPG', 'PNG'],
        document: ['PDF', 'TXT'],
        video: ['MP4', 'MOV'],
      }

      // Temporarily mock FILE_EXTS
      const originalFileExts = { ...FILE_EXTS }
      Object.assign(FILE_EXTS, mockFileExts)

      const result = getSupportFileExtensionList(
        ['image', 'document'],
        [],
      )
      expect(result).toEqual(['JPG', 'PNG', 'PDF', 'TXT'])

      // Restore original FILE_EXTS
      Object.assign(FILE_EXTS, originalFileExts)
    })

    it('should return empty array for empty inputs', () => {
      const result = getSupportFileExtensionList([], [])
      expect(result).toEqual([])
    })

    it('should prioritize custom types over standard types', () => {
      const mockFileExts = {
        image: ['JPG', 'PNG'],
      }

      // Temporarily mock FILE_EXTS
      const originalFileExts = { ...FILE_EXTS }
      Object.assign(FILE_EXTS, mockFileExts)

      const result = getSupportFileExtensionList(
        [SupportUploadFileTypes.custom, 'image'],
        ['.csv', '.xml'],
      )
      expect(result).toEqual(['CSV', 'XML'])

      // Restore original FILE_EXTS
      Object.assign(FILE_EXTS, originalFileExts)
    })
  })

  describe('isAllowedFileExtension', () => {
    it('should validate allowed file extensions', () => {
      expect(isAllowedFileExtension(
        'test.pdf',
        'application/pdf',
        ['document'],
        ['.pdf'],
      )).toBe(true)
    })
  })

  describe('getFilesInLogs', () => {
    const mockFileData = {
      dify_model_identity: '__dify__file__',
      related_id: '123',
      filename: 'test.pdf',
      size: 1024,
      mime_type: 'application/pdf',
      transfer_method: 'local_file',
      type: 'document',
      url: 'http://example.com/test.pdf',
    }

    it('should handle empty or null input', () => {
      expect(getFilesInLogs(null)).toEqual([])
      expect(getFilesInLogs({})).toEqual([])
      expect(getFilesInLogs(undefined)).toEqual([])
    })

    it('should process single file object', () => {
      const input = {
        file1: mockFileData,
      }

      const expected = [{
        varName: 'file1',
        list: [{
          id: '123',
          name: 'test.pdf',
          size: 1024,
          type: 'application/pdf',
          progress: 100,
          transferMethod: 'local_file',
          supportFileType: 'document',
          uploadedId: '123',
          url: 'http://example.com/test.pdf',
        }],
      }]

      expect(getFilesInLogs(input)).toEqual(expected)
    })

    it('should process array of files', () => {
      const input = {
        files: [mockFileData, mockFileData],
      }

      const expected = [{
        varName: 'files',
        list: [
          {
            id: '123',
            name: 'test.pdf',
            size: 1024,
            type: 'application/pdf',
            progress: 100,
            transferMethod: 'local_file',
            supportFileType: 'document',
            uploadedId: '123',
            url: 'http://example.com/test.pdf',
          },
          {
            id: '123',
            name: 'test.pdf',
            size: 1024,
            type: 'application/pdf',
            progress: 100,
            transferMethod: 'local_file',
            supportFileType: 'document',
            uploadedId: '123',
            url: 'http://example.com/test.pdf',
          },
        ],
      }]

      expect(getFilesInLogs(input)).toEqual(expected)
    })

    it('should ignore non-file objects and arrays', () => {
      const input = {
        regularString: 'not a file',
        regularNumber: 123,
        regularArray: [1, 2, 3],
        regularObject: { key: 'value' },
        file: mockFileData,
      }

      const expected = [{
        varName: 'file',
        list: [{
          id: '123',
          name: 'test.pdf',
          size: 1024,
          type: 'application/pdf',
          progress: 100,
          transferMethod: 'local_file',
          supportFileType: 'document',
          uploadedId: '123',
          url: 'http://example.com/test.pdf',
        }],
      }]

      expect(getFilesInLogs(input)).toEqual(expected)
    })

    it('should handle mixed file types in array', () => {
      const input = {
        mixedFiles: [
          mockFileData,
          { notAFile: true },
          mockFileData,
        ],
      }

      const expected = [{
        varName: 'mixedFiles',
        list: [
          {
            id: '123',
            name: 'test.pdf',
            size: 1024,
            type: 'application/pdf',
            progress: 100,
            transferMethod: 'local_file',
            supportFileType: 'document',
            uploadedId: '123',
            url: 'http://example.com/test.pdf',
          },
          {
            id: undefined,
            name: undefined,
            progress: 100,
            size: 0,
            supportFileType: undefined,
            transferMethod: undefined,
            type: undefined,
            uploadedId: undefined,
            url: undefined,
          },
          {
            id: '123',
            name: 'test.pdf',
            size: 1024,
            type: 'application/pdf',
            progress: 100,
            transferMethod: 'local_file',
            supportFileType: 'document',
            uploadedId: '123',
            url: 'http://example.com/test.pdf',
          },
        ],
      }]

      expect(getFilesInLogs(input)).toEqual(expected)
    })
  })

  describe('fileIsUploaded', () => {
    it('should identify uploaded files', () => {
      expect(fileIsUploaded({
        uploadedId: '123',
        progress: 100,
      } as any)).toBe(true)
    })

    it('should identify remote files as uploaded', () => {
      expect(fileIsUploaded({
        transferMethod: TransferMethod.remote_url,
        progress: 100,
      } as any)).toBe(true)
    })
  })
})
