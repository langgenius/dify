import type { FileEntity } from './types'
import type { FileUploadConfigResponse } from '@/models/common'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_IMAGE_FILE_BATCH_LIMIT,
  DEFAULT_IMAGE_FILE_SIZE_LIMIT,
  DEFAULT_SINGLE_CHUNK_ATTACHMENT_LIMIT,
} from './constants'
import { fileIsUploaded, getFileType, getFileUploadConfig, traverseFileEntry } from './utils'

describe('image-uploader utils', () => {
  describe('getFileType', () => {
    it('should return file extension for a simple filename', () => {
      const file = { name: 'image.png' } as File
      expect(getFileType(file)).toBe('png')
    })

    it('should return file extension for filename with multiple dots', () => {
      const file = { name: 'my.photo.image.jpg' } as File
      expect(getFileType(file)).toBe('jpg')
    })

    it('should return empty string for null/undefined file', () => {
      expect(getFileType(null as unknown as File)).toBe('')
      expect(getFileType(undefined as unknown as File)).toBe('')
    })

    it('should return filename for file without extension', () => {
      const file = { name: 'README' } as File
      expect(getFileType(file)).toBe('README')
    })

    it('should handle various file extensions', () => {
      expect(getFileType({ name: 'doc.pdf' } as File)).toBe('pdf')
      expect(getFileType({ name: 'image.jpeg' } as File)).toBe('jpeg')
      expect(getFileType({ name: 'video.mp4' } as File)).toBe('mp4')
      expect(getFileType({ name: 'archive.tar.gz' } as File)).toBe('gz')
    })
  })

  describe('fileIsUploaded', () => {
    it('should return true when uploadedId is set', () => {
      const file = { uploadedId: 'some-id', progress: 50 } as Partial<FileEntity>
      expect(fileIsUploaded(file as FileEntity)).toBe(true)
    })

    it('should return true when progress is 100', () => {
      const file = { progress: 100 } as Partial<FileEntity>
      expect(fileIsUploaded(file as FileEntity)).toBe(true)
    })

    it('should return undefined when neither uploadedId nor 100 progress', () => {
      const file = { progress: 50 } as Partial<FileEntity>
      expect(fileIsUploaded(file as FileEntity)).toBeUndefined()
    })

    it('should return undefined when progress is 0', () => {
      const file = { progress: 0 } as Partial<FileEntity>
      expect(fileIsUploaded(file as FileEntity)).toBeUndefined()
    })

    it('should return true when uploadedId is empty string and progress is 100', () => {
      const file = { uploadedId: '', progress: 100 } as Partial<FileEntity>
      expect(fileIsUploaded(file as FileEntity)).toBe(true)
    })
  })

  describe('getFileUploadConfig', () => {
    it('should return default values when response is undefined', () => {
      const result = getFileUploadConfig(undefined)
      expect(result).toEqual({
        imageFileSizeLimit: DEFAULT_IMAGE_FILE_SIZE_LIMIT,
        imageFileBatchLimit: DEFAULT_IMAGE_FILE_BATCH_LIMIT,
        singleChunkAttachmentLimit: DEFAULT_SINGLE_CHUNK_ATTACHMENT_LIMIT,
      })
    })

    it('should return values from response when valid', () => {
      const response: Partial<FileUploadConfigResponse> = {
        image_file_batch_limit: 20,
        single_chunk_attachment_limit: 10,
        attachment_image_file_size_limit: 5,
      }

      const result = getFileUploadConfig(response as FileUploadConfigResponse)
      expect(result).toEqual({
        imageFileSizeLimit: 5,
        imageFileBatchLimit: 20,
        singleChunkAttachmentLimit: 10,
      })
    })

    it('should use default values when response values are 0', () => {
      const response: Partial<FileUploadConfigResponse> = {
        image_file_batch_limit: 0,
        single_chunk_attachment_limit: 0,
        attachment_image_file_size_limit: 0,
      }

      const result = getFileUploadConfig(response as FileUploadConfigResponse)
      expect(result).toEqual({
        imageFileSizeLimit: DEFAULT_IMAGE_FILE_SIZE_LIMIT,
        imageFileBatchLimit: DEFAULT_IMAGE_FILE_BATCH_LIMIT,
        singleChunkAttachmentLimit: DEFAULT_SINGLE_CHUNK_ATTACHMENT_LIMIT,
      })
    })

    it('should use default values when response values are negative', () => {
      const response: Partial<FileUploadConfigResponse> = {
        image_file_batch_limit: -5,
        single_chunk_attachment_limit: -10,
        attachment_image_file_size_limit: -1,
      }

      const result = getFileUploadConfig(response as FileUploadConfigResponse)
      expect(result).toEqual({
        imageFileSizeLimit: DEFAULT_IMAGE_FILE_SIZE_LIMIT,
        imageFileBatchLimit: DEFAULT_IMAGE_FILE_BATCH_LIMIT,
        singleChunkAttachmentLimit: DEFAULT_SINGLE_CHUNK_ATTACHMENT_LIMIT,
      })
    })

    it('should handle string values in response', () => {
      const response = {
        image_file_batch_limit: '15',
        single_chunk_attachment_limit: '8',
        attachment_image_file_size_limit: '3',
      } as unknown as FileUploadConfigResponse

      const result = getFileUploadConfig(response)
      expect(result).toEqual({
        imageFileSizeLimit: 3,
        imageFileBatchLimit: 15,
        singleChunkAttachmentLimit: 8,
      })
    })

    it('should handle null values in response', () => {
      const response = {
        image_file_batch_limit: null,
        single_chunk_attachment_limit: null,
        attachment_image_file_size_limit: null,
      } as unknown as FileUploadConfigResponse

      const result = getFileUploadConfig(response)
      expect(result).toEqual({
        imageFileSizeLimit: DEFAULT_IMAGE_FILE_SIZE_LIMIT,
        imageFileBatchLimit: DEFAULT_IMAGE_FILE_BATCH_LIMIT,
        singleChunkAttachmentLimit: DEFAULT_SINGLE_CHUNK_ATTACHMENT_LIMIT,
      })
    })

    it('should handle undefined values in response', () => {
      const response = {
        image_file_batch_limit: undefined,
        single_chunk_attachment_limit: undefined,
        attachment_image_file_size_limit: undefined,
      } as unknown as FileUploadConfigResponse

      const result = getFileUploadConfig(response)
      expect(result).toEqual({
        imageFileSizeLimit: DEFAULT_IMAGE_FILE_SIZE_LIMIT,
        imageFileBatchLimit: DEFAULT_IMAGE_FILE_BATCH_LIMIT,
        singleChunkAttachmentLimit: DEFAULT_SINGLE_CHUNK_ATTACHMENT_LIMIT,
      })
    })

    it('should handle partial response', () => {
      const response: Partial<FileUploadConfigResponse> = {
        image_file_batch_limit: 25,
      }

      const result = getFileUploadConfig(response as FileUploadConfigResponse)
      expect(result.imageFileBatchLimit).toBe(25)
      expect(result.imageFileSizeLimit).toBe(DEFAULT_IMAGE_FILE_SIZE_LIMIT)
      expect(result.singleChunkAttachmentLimit).toBe(DEFAULT_SINGLE_CHUNK_ATTACHMENT_LIMIT)
    })

    it('should handle non-number non-string values (object, boolean, etc) with default fallback', () => {
      // This tests the getNumberValue function's final return 0 case
      // When value is neither number nor string (e.g., object, boolean, array)
      const response = {
        image_file_batch_limit: { invalid: 'object' }, // Object - not number or string
        single_chunk_attachment_limit: true, // Boolean - not number or string
        attachment_image_file_size_limit: ['array'], // Array - not number or string
      } as unknown as FileUploadConfigResponse

      const result = getFileUploadConfig(response)
      // All should fall back to defaults since getNumberValue returns 0 for these types
      expect(result).toEqual({
        imageFileSizeLimit: DEFAULT_IMAGE_FILE_SIZE_LIMIT,
        imageFileBatchLimit: DEFAULT_IMAGE_FILE_BATCH_LIMIT,
        singleChunkAttachmentLimit: DEFAULT_SINGLE_CHUNK_ATTACHMENT_LIMIT,
      })
    })

    it('should handle NaN string values', () => {
      const response = {
        image_file_batch_limit: 'not-a-number',
        single_chunk_attachment_limit: '',
        attachment_image_file_size_limit: 'abc',
      } as unknown as FileUploadConfigResponse

      const result = getFileUploadConfig(response)
      // NaN values should result in defaults (since NaN > 0 is false)
      expect(result).toEqual({
        imageFileSizeLimit: DEFAULT_IMAGE_FILE_SIZE_LIMIT,
        imageFileBatchLimit: DEFAULT_IMAGE_FILE_BATCH_LIMIT,
        singleChunkAttachmentLimit: DEFAULT_SINGLE_CHUNK_ATTACHMENT_LIMIT,
      })
    })
  })

  describe('traverseFileEntry', () => {
    type MockFile = { name: string, relativePath?: string }
    type FileCallback = (file: MockFile) => void
    type EntriesCallback = (entries: FileSystemEntry[]) => void

    it('should resolve with file array for file entry', async () => {
      const mockFile: MockFile = { name: 'test.png' }
      const mockEntry = {
        isFile: true,
        isDirectory: false,
        file: (callback: FileCallback) => callback(mockFile),
      }

      const result = await traverseFileEntry(mockEntry)
      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('test.png')
      expect(result[0].relativePath).toBe('test.png')
    })

    it('should resolve with file array with prefix for nested file', async () => {
      const mockFile: MockFile = { name: 'test.png' }
      const mockEntry = {
        isFile: true,
        isDirectory: false,
        file: (callback: FileCallback) => callback(mockFile),
      }

      const result = await traverseFileEntry(mockEntry, 'folder/')
      expect(result).toHaveLength(1)
      expect(result[0].relativePath).toBe('folder/test.png')
    })

    it('should resolve empty array for unknown entry type', async () => {
      const mockEntry = {
        isFile: false,
        isDirectory: false,
      }

      const result = await traverseFileEntry(mockEntry)
      expect(result).toEqual([])
    })

    it('should handle directory with no files', async () => {
      const mockEntry = {
        isFile: false,
        isDirectory: true,
        name: 'empty-folder',
        createReader: () => ({
          readEntries: (callback: EntriesCallback) => callback([]),
        }),
      }

      const result = await traverseFileEntry(mockEntry)
      expect(result).toEqual([])
    })

    it('should handle directory with files', async () => {
      const mockFile1: MockFile = { name: 'file1.png' }
      const mockFile2: MockFile = { name: 'file2.png' }

      const mockFileEntry1 = {
        isFile: true,
        isDirectory: false,
        file: (callback: FileCallback) => callback(mockFile1),
      }

      const mockFileEntry2 = {
        isFile: true,
        isDirectory: false,
        file: (callback: FileCallback) => callback(mockFile2),
      }

      let readCount = 0
      const mockEntry = {
        isFile: false,
        isDirectory: true,
        name: 'folder',
        createReader: () => ({
          readEntries: (callback: EntriesCallback) => {
            if (readCount === 0) {
              readCount++
              callback([mockFileEntry1, mockFileEntry2] as unknown as FileSystemEntry[])
            }
            else {
              callback([])
            }
          },
        }),
      }

      const result = await traverseFileEntry(mockEntry)
      expect(result).toHaveLength(2)
      expect(result[0].relativePath).toBe('folder/file1.png')
      expect(result[1].relativePath).toBe('folder/file2.png')
    })
  })
})
