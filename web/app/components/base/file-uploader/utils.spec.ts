import type { MockInstance } from 'vitest'
import mime from 'mime'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import { upload } from '@/service/base'
import { TransferMethod } from '@/types/app'
import { FILE_EXTS } from '../prompt-editor/constants'
import { FileAppearanceTypeEnum } from './types'
import {
  downloadFile,
  fileIsUploaded,
  fileUpload,
  getFileAppearanceType,
  getFileExtension,
  getFileNameFromUrl,
  getFilesInLogs,
  getProcessedFiles,
  getProcessedFilesFromResponse,
  getSupportFileExtensionList,
  getSupportFileType,
  isAllowedFileExtension,
} from './utils'

vi.mock('mime', () => ({
  default: {
    getAllExtensions: vi.fn(),
  },
}))

vi.mock('@/service/base', () => ({
  upload: vi.fn(),
}))

describe('file-uploader utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('fileUpload', () => {
    it('should handle successful file upload', () => {
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
    })
  })

  describe('getFileExtension', () => {
    it('should get extension from mimetype', () => {
      vi.mocked(mime.getAllExtensions).mockReturnValue(new Set(['pdf']))
      expect(getFileExtension('file', 'application/pdf')).toBe('pdf')
    })

    it('should get extension from mimetype and file name 1', () => {
      vi.mocked(mime.getAllExtensions).mockReturnValue(new Set(['pdf']))
      expect(getFileExtension('file.pdf', 'application/pdf')).toBe('pdf')
    })

    it('should get extension from mimetype with multiple ext candidates with filename hint', () => {
      vi.mocked(mime.getAllExtensions).mockReturnValue(new Set(['der', 'crt', 'pem']))
      expect(getFileExtension('file.pem', 'application/x-x509-ca-cert')).toBe('pem')
    })

    it('should get extension from mimetype with multiple ext candidates without filename hint', () => {
      vi.mocked(mime.getAllExtensions).mockReturnValue(new Set(['der', 'crt', 'pem']))
      expect(getFileExtension('file', 'application/x-x509-ca-cert')).toBe('der')
    })

    it('should get extension from filename if mimetype fails', () => {
      vi.mocked(mime.getAllExtensions).mockReturnValue(null)
      expect(getFileExtension('file.txt', '')).toBe('txt')
      expect(getFileExtension('file.txt.docx', '')).toBe('docx')
      expect(getFileExtension('file', '')).toBe('')
    })

    it('should return empty string for remote files', () => {
      expect(getFileExtension('file.txt', '', true)).toBe('')
    })
  })

  describe('getFileAppearanceType', () => {
    it('should identify gif files', () => {
      vi.mocked(mime.getAllExtensions).mockReturnValue(new Set(['gif']))
      expect(getFileAppearanceType('image.gif', 'image/gif'))
        .toBe(FileAppearanceTypeEnum.gif)
    })

    it('should identify image files', () => {
      vi.mocked(mime.getAllExtensions).mockReturnValue(new Set(['jpg']))
      expect(getFileAppearanceType('image.jpg', 'image/jpeg'))
        .toBe(FileAppearanceTypeEnum.image)

      vi.mocked(mime.getAllExtensions).mockReturnValue(new Set(['jpeg']))
      expect(getFileAppearanceType('image.jpeg', 'image/jpeg'))
        .toBe(FileAppearanceTypeEnum.image)

      vi.mocked(mime.getAllExtensions).mockReturnValue(new Set(['png']))
      expect(getFileAppearanceType('image.png', 'image/png'))
        .toBe(FileAppearanceTypeEnum.image)

      vi.mocked(mime.getAllExtensions).mockReturnValue(new Set(['webp']))
      expect(getFileAppearanceType('image.webp', 'image/webp'))
        .toBe(FileAppearanceTypeEnum.image)

      vi.mocked(mime.getAllExtensions).mockReturnValue(new Set(['svg']))
      expect(getFileAppearanceType('image.svg', 'image/svgxml'))
        .toBe(FileAppearanceTypeEnum.image)
    })

    it('should identify video files', () => {
      vi.mocked(mime.getAllExtensions).mockReturnValue(new Set(['mp4']))
      expect(getFileAppearanceType('video.mp4', 'video/mp4'))
        .toBe(FileAppearanceTypeEnum.video)

      vi.mocked(mime.getAllExtensions).mockReturnValue(new Set(['mov']))
      expect(getFileAppearanceType('video.mov', 'video/quicktime'))
        .toBe(FileAppearanceTypeEnum.video)

      vi.mocked(mime.getAllExtensions).mockReturnValue(new Set(['mpeg']))
      expect(getFileAppearanceType('video.mpeg', 'video/mpeg'))
        .toBe(FileAppearanceTypeEnum.video)

      vi.mocked(mime.getAllExtensions).mockReturnValue(new Set(['webm']))
      expect(getFileAppearanceType('video.web', 'video/webm'))
        .toBe(FileAppearanceTypeEnum.video)
    })

    it('should identify audio files', () => {
      vi.mocked(mime.getAllExtensions).mockReturnValue(new Set(['mp3']))
      expect(getFileAppearanceType('audio.mp3', 'audio/mpeg'))
        .toBe(FileAppearanceTypeEnum.audio)

      vi.mocked(mime.getAllExtensions).mockReturnValue(new Set(['m4a']))
      expect(getFileAppearanceType('audio.m4a', 'audio/mp4'))
        .toBe(FileAppearanceTypeEnum.audio)

      vi.mocked(mime.getAllExtensions).mockReturnValue(new Set(['wav']))
      expect(getFileAppearanceType('audio.wav', 'audio/vnd.wav'))
        .toBe(FileAppearanceTypeEnum.audio)

      vi.mocked(mime.getAllExtensions).mockReturnValue(new Set(['amr']))
      expect(getFileAppearanceType('audio.amr', 'audio/AMR'))
        .toBe(FileAppearanceTypeEnum.audio)

      vi.mocked(mime.getAllExtensions).mockReturnValue(new Set(['mpga']))
      expect(getFileAppearanceType('audio.mpga', 'audio/mpeg'))
        .toBe(FileAppearanceTypeEnum.audio)
    })

    it('should identify code files', () => {
      vi.mocked(mime.getAllExtensions).mockReturnValue(new Set(['html']))
      expect(getFileAppearanceType('index.html', 'text/html'))
        .toBe(FileAppearanceTypeEnum.code)
    })

    it('should identify PDF files', () => {
      vi.mocked(mime.getAllExtensions).mockReturnValue(new Set(['pdf']))
      expect(getFileAppearanceType('doc.pdf', 'application/pdf'))
        .toBe(FileAppearanceTypeEnum.pdf)
    })

    it('should identify markdown files', () => {
      vi.mocked(mime.getAllExtensions).mockReturnValue(new Set(['md']))
      expect(getFileAppearanceType('file.md', 'text/markdown'))
        .toBe(FileAppearanceTypeEnum.markdown)

      vi.mocked(mime.getAllExtensions).mockReturnValue(new Set(['markdown']))
      expect(getFileAppearanceType('file.markdown', 'text/markdown'))
        .toBe(FileAppearanceTypeEnum.markdown)

      vi.mocked(mime.getAllExtensions).mockReturnValue(new Set(['mdx']))
      expect(getFileAppearanceType('file.mdx', 'text/mdx'))
        .toBe(FileAppearanceTypeEnum.markdown)
    })

    it('should identify excel files', () => {
      vi.mocked(mime.getAllExtensions).mockReturnValue(new Set(['xlsx']))
      expect(getFileAppearanceType('doc.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'))
        .toBe(FileAppearanceTypeEnum.excel)

      vi.mocked(mime.getAllExtensions).mockReturnValue(new Set(['xls']))
      expect(getFileAppearanceType('doc.xls', 'application/vnd.ms-excel'))
        .toBe(FileAppearanceTypeEnum.excel)
    })

    it('should identify word files', () => {
      vi.mocked(mime.getAllExtensions).mockReturnValue(new Set(['doc']))
      expect(getFileAppearanceType('doc.doc', 'application/msword'))
        .toBe(FileAppearanceTypeEnum.word)

      vi.mocked(mime.getAllExtensions).mockReturnValue(new Set(['docx']))
      expect(getFileAppearanceType('doc.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'))
        .toBe(FileAppearanceTypeEnum.word)
    })

    it('should identify word files', () => {
      vi.mocked(mime.getAllExtensions).mockReturnValue(new Set(['ppt']))
      expect(getFileAppearanceType('doc.ppt', 'application/vnd.ms-powerpoint'))
        .toBe(FileAppearanceTypeEnum.ppt)

      vi.mocked(mime.getAllExtensions).mockReturnValue(new Set(['pptx']))
      expect(getFileAppearanceType('doc.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'))
        .toBe(FileAppearanceTypeEnum.ppt)
    })

    it('should identify document files', () => {
      vi.mocked(mime.getAllExtensions).mockReturnValue(new Set(['txt']))
      expect(getFileAppearanceType('file.txt', 'text/plain'))
        .toBe(FileAppearanceTypeEnum.document)

      vi.mocked(mime.getAllExtensions).mockReturnValue(new Set(['csv']))
      expect(getFileAppearanceType('file.csv', 'text/csv'))
        .toBe(FileAppearanceTypeEnum.document)

      vi.mocked(mime.getAllExtensions).mockReturnValue(new Set(['msg']))
      expect(getFileAppearanceType('file.msg', 'application/vnd.ms-outlook'))
        .toBe(FileAppearanceTypeEnum.document)

      vi.mocked(mime.getAllExtensions).mockReturnValue(new Set(['eml']))
      expect(getFileAppearanceType('file.eml', 'message/rfc822'))
        .toBe(FileAppearanceTypeEnum.document)

      vi.mocked(mime.getAllExtensions).mockReturnValue(new Set(['xml']))
      expect(getFileAppearanceType('file.xml', 'application/rssxml'))
        .toBe(FileAppearanceTypeEnum.document)

      vi.mocked(mime.getAllExtensions).mockReturnValue(new Set(['epub']))
      expect(getFileAppearanceType('file.epub', 'application/epubzip'))
        .toBe(FileAppearanceTypeEnum.document)
    })

    it('should handle null mime extension', () => {
      vi.mocked(mime.getAllExtensions).mockReturnValue(null)
      expect(getFileAppearanceType('file.txt', 'text/plain'))
        .toBe(FileAppearanceTypeEnum.document)
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
  })

  describe('getProcessedFilesFromResponse', () => {
    beforeEach(() => {
      vi.mocked(mime.getAllExtensions).mockImplementation((mimeType: string) => {
        const mimeMap: Record<string, Set<string>> = {
          'image/jpeg': new Set(['jpg', 'jpeg']),
          'image/png': new Set(['png']),
          'image/gif': new Set(['gif']),
          'video/mp4': new Set(['mp4']),
          'audio/mp3': new Set(['mp3']),
          'application/pdf': new Set(['pdf']),
          'text/plain': new Set(['txt']),
          'application/json': new Set(['json']),
        }
        return mimeMap[mimeType] || new Set()
      })
    })

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
        mime_type: 'audio/mp3',
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

    it('should NOT correct when filename and MIME type both point to wrong type', () => {
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
      vi.mocked(mime.getAllExtensions).mockReturnValue(new Set(['pdf']))
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

  describe('downloadFile', () => {
    let mockAnchor: HTMLAnchorElement
    let createElementMock: MockInstance
    let appendChildMock: MockInstance
    let removeChildMock: MockInstance

    beforeEach(() => {
      // Mock createElement and appendChild
      mockAnchor = {
        href: '',
        download: '',
        style: { display: '' },
        target: '',
        title: '',
        click: vi.fn(),
      } as unknown as HTMLAnchorElement

      createElementMock = vi.spyOn(document, 'createElement').mockReturnValue(mockAnchor as any)
      appendChildMock = vi.spyOn(document.body, 'appendChild').mockImplementation((node: Node) => {
        return node
      })
      removeChildMock = vi.spyOn(document.body, 'removeChild').mockImplementation((node: Node) => {
        return node
      })
    })

    afterEach(() => {
      vi.resetAllMocks()
    })

    it('should create and trigger download with correct attributes', () => {
      const url = 'https://example.com/test.pdf'
      const filename = 'test.pdf'

      downloadFile(url, filename)

      // Verify anchor element was created with correct properties
      expect(createElementMock).toHaveBeenCalledWith('a')
      expect(mockAnchor.href).toBe(url)
      expect(mockAnchor.download).toBe(filename)
      expect(mockAnchor.style.display).toBe('none')
      expect(mockAnchor.target).toBe('_blank')
      expect(mockAnchor.title).toBe(filename)

      // Verify DOM operations
      expect(appendChildMock).toHaveBeenCalledWith(mockAnchor)
      expect(mockAnchor.click).toHaveBeenCalled()
      expect(removeChildMock).toHaveBeenCalledWith(mockAnchor)
    })

    it('should handle empty filename', () => {
      const url = 'https://example.com/test.pdf'
      const filename = ''

      downloadFile(url, filename)

      expect(mockAnchor.download).toBe('')
      expect(mockAnchor.title).toBe('')
    })

    it('should handle empty url', () => {
      const url = ''
      const filename = 'test.pdf'

      downloadFile(url, filename)

      expect(mockAnchor.href).toBe('')
    })
  })
})
