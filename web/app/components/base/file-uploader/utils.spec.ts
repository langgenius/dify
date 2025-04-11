import mime from 'mime'
import { upload } from '@/service/base'
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
import { FileAppearanceTypeEnum } from './types'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import { TransferMethod } from '@/types/app'
import { FILE_EXTS } from '../prompt-editor/constants'

jest.mock('mime', () => ({
  __esModule: true,
  default: {
    getExtension: jest.fn(),
  },
}))

jest.mock('@/service/base', () => ({
  upload: jest.fn(),
}))

describe('file-uploader utils', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('fileUpload', () => {
    it('should handle successful file upload', async () => {
      const mockFile = new File(['test'], 'test.txt')
      const mockCallbacks = {
        onProgressCallback: jest.fn(),
        onSuccessCallback: jest.fn(),
        onErrorCallback: jest.fn(),
      }

      jest.mocked(upload).mockResolvedValue({ id: '123' })

      await fileUpload({
        file: mockFile,
        ...mockCallbacks,
      })

      expect(upload).toHaveBeenCalled()
      expect(mockCallbacks.onSuccessCallback).toHaveBeenCalledWith({ id: '123' })
    })
  })

  describe('getFileExtension', () => {
    it('should get extension from mimetype', () => {
      jest.mocked(mime.getExtension).mockReturnValue('pdf')
      expect(getFileExtension('file', 'application/pdf')).toBe('pdf')
    })

    it('should get extension from filename if mimetype fails', () => {
      jest.mocked(mime.getExtension).mockReturnValue(null)
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
      jest.mocked(mime.getExtension).mockReturnValue('gif')
      expect(getFileAppearanceType('image.gif', 'image/gif'))
        .toBe(FileAppearanceTypeEnum.gif)
    })

    it('should identify image files', () => {
      jest.mocked(mime.getExtension).mockReturnValue('jpg')
      expect(getFileAppearanceType('image.jpg', 'image/jpeg'))
        .toBe(FileAppearanceTypeEnum.image)

      jest.mocked(mime.getExtension).mockReturnValue('jpeg')
      expect(getFileAppearanceType('image.jpeg', 'image/jpeg'))
        .toBe(FileAppearanceTypeEnum.image)

      jest.mocked(mime.getExtension).mockReturnValue('png')
      expect(getFileAppearanceType('image.png', 'image/png'))
        .toBe(FileAppearanceTypeEnum.image)

      jest.mocked(mime.getExtension).mockReturnValue('webp')
      expect(getFileAppearanceType('image.webp', 'image/webp'))
        .toBe(FileAppearanceTypeEnum.image)

      jest.mocked(mime.getExtension).mockReturnValue('svg')
      expect(getFileAppearanceType('image.svg', 'image/svgxml'))
        .toBe(FileAppearanceTypeEnum.image)
    })

    it('should identify video files', () => {
      jest.mocked(mime.getExtension).mockReturnValue('mp4')
      expect(getFileAppearanceType('video.mp4', 'video/mp4'))
        .toBe(FileAppearanceTypeEnum.video)

      jest.mocked(mime.getExtension).mockReturnValue('mov')
      expect(getFileAppearanceType('video.mov', 'video/quicktime'))
        .toBe(FileAppearanceTypeEnum.video)

      jest.mocked(mime.getExtension).mockReturnValue('mpeg')
      expect(getFileAppearanceType('video.mpeg', 'video/mpeg'))
        .toBe(FileAppearanceTypeEnum.video)

      jest.mocked(mime.getExtension).mockReturnValue('webm')
      expect(getFileAppearanceType('video.web', 'video/webm'))
        .toBe(FileAppearanceTypeEnum.video)
    })

    it('should identify audio files', () => {
      jest.mocked(mime.getExtension).mockReturnValue('mp3')
      expect(getFileAppearanceType('audio.mp3', 'audio/mpeg'))
        .toBe(FileAppearanceTypeEnum.audio)

      jest.mocked(mime.getExtension).mockReturnValue('m4a')
      expect(getFileAppearanceType('audio.m4a', 'audio/mp4'))
        .toBe(FileAppearanceTypeEnum.audio)

      jest.mocked(mime.getExtension).mockReturnValue('wav')
      expect(getFileAppearanceType('audio.wav', 'audio/vnd.wav'))
        .toBe(FileAppearanceTypeEnum.audio)

      jest.mocked(mime.getExtension).mockReturnValue('amr')
      expect(getFileAppearanceType('audio.amr', 'audio/AMR'))
        .toBe(FileAppearanceTypeEnum.audio)

      jest.mocked(mime.getExtension).mockReturnValue('mpga')
      expect(getFileAppearanceType('audio.mpga', 'audio/mpeg'))
        .toBe(FileAppearanceTypeEnum.audio)
    })

    it('should identify code files', () => {
      jest.mocked(mime.getExtension).mockReturnValue('html')
      expect(getFileAppearanceType('index.html', 'text/html'))
        .toBe(FileAppearanceTypeEnum.code)
    })

    it('should identify PDF files', () => {
      jest.mocked(mime.getExtension).mockReturnValue('pdf')
      expect(getFileAppearanceType('doc.pdf', 'application/pdf'))
        .toBe(FileAppearanceTypeEnum.pdf)
    })

    it('should identify markdown files', () => {
      jest.mocked(mime.getExtension).mockReturnValue('md')
      expect(getFileAppearanceType('file.md', 'text/markdown'))
        .toBe(FileAppearanceTypeEnum.markdown)

      jest.mocked(mime.getExtension).mockReturnValue('markdown')
      expect(getFileAppearanceType('file.markdown', 'text/markdown'))
        .toBe(FileAppearanceTypeEnum.markdown)

      jest.mocked(mime.getExtension).mockReturnValue('mdx')
      expect(getFileAppearanceType('file.mdx', 'text/mdx'))
        .toBe(FileAppearanceTypeEnum.markdown)
    })

    it('should identify excel files', () => {
      jest.mocked(mime.getExtension).mockReturnValue('xlsx')
      expect(getFileAppearanceType('doc.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'))
        .toBe(FileAppearanceTypeEnum.excel)

      jest.mocked(mime.getExtension).mockReturnValue('xls')
      expect(getFileAppearanceType('doc.xls', 'application/vnd.ms-excel'))
        .toBe(FileAppearanceTypeEnum.excel)
    })

    it('should identify word files', () => {
      jest.mocked(mime.getExtension).mockReturnValue('doc')
      expect(getFileAppearanceType('doc.doc', 'application/msword'))
        .toBe(FileAppearanceTypeEnum.word)

      jest.mocked(mime.getExtension).mockReturnValue('docx')
      expect(getFileAppearanceType('doc.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'))
        .toBe(FileAppearanceTypeEnum.word)
    })

    it('should identify word files', () => {
      jest.mocked(mime.getExtension).mockReturnValue('ppt')
      expect(getFileAppearanceType('doc.ppt', 'application/vnd.ms-powerpoint'))
        .toBe(FileAppearanceTypeEnum.ppt)

      jest.mocked(mime.getExtension).mockReturnValue('pptx')
      expect(getFileAppearanceType('doc.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'))
        .toBe(FileAppearanceTypeEnum.ppt)
    })

    it('should identify document files', () => {
      jest.mocked(mime.getExtension).mockReturnValue('txt')
      expect(getFileAppearanceType('file.txt', 'text/plain'))
        .toBe(FileAppearanceTypeEnum.document)

      jest.mocked(mime.getExtension).mockReturnValue('csv')
      expect(getFileAppearanceType('file.csv', 'text/csv'))
        .toBe(FileAppearanceTypeEnum.document)

      jest.mocked(mime.getExtension).mockReturnValue('msg')
      expect(getFileAppearanceType('file.msg', 'application/vnd.ms-outlook'))
        .toBe(FileAppearanceTypeEnum.document)

      jest.mocked(mime.getExtension).mockReturnValue('eml')
      expect(getFileAppearanceType('file.eml', 'message/rfc822'))
        .toBe(FileAppearanceTypeEnum.document)

      jest.mocked(mime.getExtension).mockReturnValue('xml')
      expect(getFileAppearanceType('file.xml', 'application/rssxml'))
        .toBe(FileAppearanceTypeEnum.document)

      jest.mocked(mime.getExtension).mockReturnValue('epub')
      expect(getFileAppearanceType('file.epub', 'application/epubzip'))
        .toBe(FileAppearanceTypeEnum.document)
    })

    it('should handle null mime extension', () => {
      jest.mocked(mime.getExtension).mockReturnValue(null)
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
    it('should process files correctly', () => {
      const files = [{
        related_id: '2a38e2ca-1295-415d-a51d-65d4ff9912d9',
        extension: '.jpeg',
        filename: 'test.jpeg',
        size: 2881761,
        mime_type: 'image/jpeg',
        transfer_method: TransferMethod.local_file,
        type: 'image',
        url: 'https://upload.dify.dev/files/xxx/file-preview',
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
      jest.mocked(mime.getExtension).mockReturnValue('pdf')
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
    let createElementMock: jest.SpyInstance
    let appendChildMock: jest.SpyInstance
    let removeChildMock: jest.SpyInstance

    beforeEach(() => {
      // Mock createElement and appendChild
      mockAnchor = {
        href: '',
        download: '',
        style: { display: '' },
        target: '',
        title: '',
        click: jest.fn(),
      } as unknown as HTMLAnchorElement

      createElementMock = jest.spyOn(document, 'createElement').mockReturnValue(mockAnchor as any)
      appendChildMock = jest.spyOn(document.body, 'appendChild').mockImplementation((node: Node) => {
        return node
      })
      removeChildMock = jest.spyOn(document.body, 'removeChild').mockImplementation((node: Node) => {
        return node
      })
    })

    afterEach(() => {
      jest.resetAllMocks()
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
