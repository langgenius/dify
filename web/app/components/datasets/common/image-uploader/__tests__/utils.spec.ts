import type { FileEntity } from '../types'
import { createFileUploadConfigFixture } from '@/test/fixtures/file-upload-config'
import {
  DEFAULT_IMAGE_FILE_BATCH_LIMIT,
  DEFAULT_IMAGE_FILE_SIZE_LIMIT,
  DEFAULT_SINGLE_CHUNK_ATTACHMENT_LIMIT,
} from '../constants'
import { fileIsUploaded, getFileType, getFileUploadConfig, traverseFileEntry } from '../utils'

describe('image uploader utilities', () => {
  it.each([
    ['image.png', 'png'],
    ['archive.tar.gz', 'gz'],
    ['README', 'README'],
  ])('extracts the last extension from %s', (name, extension) => {
    expect(getFileType(new File([], name))).toBe(extension)
  })

  it.each([
    { uploadedId: 'server-id', progress: 50, uploaded: true },
    { uploadedId: undefined, progress: 100, uploaded: true },
    { uploadedId: undefined, progress: 50, uploaded: false },
  ])(
    'recognizes uploaded files for $uploadedId at $progress percent',
    ({ uploadedId, progress, uploaded }) => {
      const file: FileEntity = {
        id: 'file-1',
        name: 'image.png',
        mimeType: 'image/png',
        extension: 'png',
        size: 1024,
        uploadedId,
        progress,
      }
      expect(Boolean(fileIsUploaded(file))).toBe(uploaded)
    },
  )

  it('uses upload defaults before configuration is available', () => {
    expect(getFileUploadConfig(undefined)).toEqual({
      imageFileSizeLimit: DEFAULT_IMAGE_FILE_SIZE_LIMIT,
      imageFileBatchLimit: DEFAULT_IMAGE_FILE_BATCH_LIMIT,
      singleChunkAttachmentLimit: DEFAULT_SINGLE_CHUNK_ATTACHMENT_LIMIT,
    })
  })

  it('uses configured limits and falls back independently for unset limits', () => {
    expect(
      getFileUploadConfig(
        createFileUploadConfigFixture({
          image_file_batch_limit: 20,
          single_chunk_attachment_limit: 0,
          attachment_image_file_size_limit: 5,
        }),
      ),
    ).toEqual({
      imageFileSizeLimit: 5,
      imageFileBatchLimit: 20,
      singleChunkAttachmentLimit: DEFAULT_SINGLE_CHUNK_ATTACHMENT_LIMIT,
    })
  })

  describe('traverseFileEntry', () => {
    type MockFile = File & { relativePath?: string }
    type FileCallback = (file: MockFile) => void
    type EntriesCallback = (entries: FileSystemEntry[]) => void

    // Helper to create mock FileSystemEntry with required properties
    const createMockEntry = (props: {
      isFile: boolean
      isDirectory: boolean
      name?: string
      file?: (callback: FileCallback) => void
      createReader?: () => { readEntries: (callback: EntriesCallback) => void }
    }): FileSystemEntry => props as FileSystemEntry

    it('should resolve with file array for file entry', async () => {
      const mockFile: MockFile = new File(['content'], 'test.png')
      const mockEntry = createMockEntry({
        isFile: true,
        isDirectory: false,
        file: (callback: FileCallback) => callback(mockFile),
      })

      const result = await traverseFileEntry(mockEntry)
      expect(result).toHaveLength(1)
      expect(result[0]!.name).toBe('test.png')
      expect(result[0]!.relativePath).toBe('test.png')
    })

    it('should resolve with file array with prefix for nested file', async () => {
      const mockFile: MockFile = new File(['content'], 'test.png')
      const mockEntry = createMockEntry({
        isFile: true,
        isDirectory: false,
        file: (callback: FileCallback) => callback(mockFile),
      })

      const result = await traverseFileEntry(mockEntry, 'folder/')
      expect(result).toHaveLength(1)
      expect(result[0]!.relativePath).toBe('folder/test.png')
    })

    it('should handle directory with no files', async () => {
      const mockEntry = createMockEntry({
        isFile: false,
        isDirectory: true,
        name: 'empty-folder',
        createReader: () => ({
          readEntries: (callback: EntriesCallback) => callback([]),
        }),
      })

      const result = await traverseFileEntry(mockEntry)
      expect(result).toEqual([])
    })

    it('should handle directory with files', async () => {
      const mockFile1: MockFile = new File(['content'], 'file1.png')
      const mockFile2: MockFile = new File(['content'], 'file2.png')

      const mockFileEntry1 = createMockEntry({
        isFile: true,
        isDirectory: false,
        file: (callback: FileCallback) => callback(mockFile1),
      })

      const mockFileEntry2 = createMockEntry({
        isFile: true,
        isDirectory: false,
        file: (callback: FileCallback) => callback(mockFile2),
      })

      let readCount = 0
      const mockEntry = createMockEntry({
        isFile: false,
        isDirectory: true,
        name: 'folder',
        createReader: () => ({
          readEntries: (callback: EntriesCallback) => {
            if (readCount === 0) {
              readCount++
              callback([mockFileEntry1, mockFileEntry2])
            } else {
              callback([])
            }
          },
        }),
      })

      const result = await traverseFileEntry(mockEntry)
      expect(result).toHaveLength(2)
      expect(result[0]!.relativePath).toBe('folder/file1.png')
      expect(result[1]!.relativePath).toBe('folder/file2.png')
    })
  })
})
