import type { ThoughtItem } from '@/app/components/base/chat/chat/type'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import type { VisionFile } from '@/types/app'
import type { FileResponse } from '@/types/workflow'
import { describe, expect, it } from 'vitest'
import { TransferMethod } from '@/types/app'
import {
  addFileInfos,
  getVisionFileMimeType,
  getVisionFileName,
  getVisionFileSupportType,
  sortAgentSorts,
} from '../index'

describe('tools/utils', () => {
  const createFileEntity = (overrides: Partial<FileEntity>): FileEntity => ({
    id: 'file-1',
    name: 'file.txt',
    size: 0,
    type: 'text/plain',
    progress: 100,
    transferMethod: TransferMethod.remote_url,
    supportFileType: 'document',
    ...overrides,
  })

  describe('sortAgentSorts', () => {
    it('returns null/undefined input as-is', () => {
      expect(sortAgentSorts(null as unknown as ThoughtItem[])).toBeNull()
      expect(sortAgentSorts(undefined as unknown as ThoughtItem[])).toBeUndefined()
    })

    it('returns unsorted when some items lack position', () => {
      const items = [
        { id: '1', position: 2 },
        { id: '2' },
      ] as unknown as ThoughtItem[]
      const result = sortAgentSorts(items)
      expect(result[0]).toEqual(expect.objectContaining({ id: '1' }))
      expect(result[1]).toEqual(expect.objectContaining({ id: '2' }))
    })

    it('sorts items by position ascending', () => {
      const items = [
        { id: 'c', position: 3 },
        { id: 'a', position: 1 },
        { id: 'b', position: 2 },
      ] as unknown as ThoughtItem[]
      const result = sortAgentSorts(items)
      expect(result.map((item: ThoughtItem & { id: string }) => item.id)).toEqual(['a', 'b', 'c'])
    })

    it('does not mutate the original array', () => {
      const items = [
        { id: 'b', position: 2 },
        { id: 'a', position: 1 },
      ] as unknown as ThoughtItem[]
      const result = sortAgentSorts(items)
      expect(result).not.toBe(items)
    })
  })

  describe('VisionFile helpers', () => {
    it.each([
      ['image', 'image/png'],
      ['video', 'video/mp4'],
      ['audio', 'audio/mpeg'],
      ['application/pdf', 'application/pdf'],
      ['document', 'application/octet-stream'],
      ['unknown', 'application/octet-stream'],
    ])('returns %s mime type as %s', (fileType, expectedMimeType) => {
      expect(getVisionFileMimeType(fileType)).toBe(expectedMimeType)
    })

    it.each([
      ['image', 'image'],
      ['video', 'video'],
      ['audio', 'audio'],
      ['document', 'document'],
      ['image/png', 'image'],
      ['video/mp4', 'video'],
      ['audio/mpeg', 'audio'],
      ['application/pdf', 'document'],
      ['application/json', 'document'],
    ] as const)('returns %s support type as %s', (fileType, expectedSupportType) => {
      expect(getVisionFileSupportType(fileType)).toBe(expectedSupportType)
    })

    it('extracts the file name from URLs with query params', () => {
      expect(getVisionFileName('https://example.com/generated.png?signature=1', 'image')).toBe('generated.png')
    })

    it.each([
      ['image', 'generated_image.png'],
      ['video', 'generated_video.mp4'],
      ['audio', 'generated_audio.mp3'],
      ['document', 'generated_file.bin'],
    ] as const)('returns a fallback file name for %s URLs without a file segment', (supportFileType, expectedFileName) => {
      expect(getVisionFileName('https://example.com/', supportFileType)).toBe(expectedFileName)
    })
  })

  describe('addFileInfos', () => {
    it('returns null/undefined input as-is', () => {
      expect(addFileInfos(null as unknown as ThoughtItem[], [])).toBeNull()
      expect(addFileInfos(undefined as unknown as ThoughtItem[], [])).toBeUndefined()
    })

    it('returns items when messageFiles is null', () => {
      const items = [{ id: '1' }] as unknown as ThoughtItem[]
      expect(addFileInfos(items, null as unknown as FileEntity[])).toEqual(items)
    })

    it('adds message_files by matching file IDs', () => {
      const file1 = createFileEntity({ id: 'file-1', name: 'doc.pdf', type: 'application/pdf' })
      const file2 = createFileEntity({ id: 'file-2', name: 'img.png', type: 'image/png', supportFileType: 'image' })
      const items = [
        { id: '1', files: ['file-1', 'file-2'] },
        { id: '2', files: [] },
      ] as unknown as ThoughtItem[]

      const result = addFileInfos(items, [file1, file2])
      expect((result[0] as ThoughtItem & { message_files: FileEntity[] }).message_files).toEqual([file1, file2])
    })

    it('normalizes backend agent file payloads into FileEntity objects', () => {
      const rawFile = {
        id: 'file-1',
        related_id: 'tool-file-1',
        extension: '.png',
        filename: 'generated.png',
        size: 128,
        mime_type: 'image/png',
        transfer_method: TransferMethod.remote_url,
        type: 'image',
        url: 'https://example.com/generated.png',
        upload_file_id: 'tool-file-1',
        remote_url: '',
      } satisfies FileResponse & { id: string }

      const items = [{ id: '1', files: ['file-1'] }] as unknown as ThoughtItem[]

      const result = addFileInfos(items, [rawFile])
      const messageFiles = (result[0] as ThoughtItem & { message_files: FileEntity[] }).message_files

      expect(messageFiles).toHaveLength(1)
      expect(messageFiles[0]).toEqual(expect.objectContaining({
        id: 'file-1',
        name: 'generated.png',
        type: 'image/png',
        supportFileType: 'image',
      }))
    })

    it('normalizes VisionFile payloads into FileEntity objects', () => {
      const visionFile: VisionFile = {
        id: 'file-vision-1',
        type: 'image',
        transfer_method: TransferMethod.remote_url,
        url: 'https://example.com/generated.png?signature=1',
        upload_file_id: 'upload-vision-1',
      }

      const items = [{ id: '1', files: ['file-vision-1'] }] as unknown as ThoughtItem[]

      const result = addFileInfos(items, [visionFile])
      const messageFiles = (result[0] as ThoughtItem & { message_files: FileEntity[] }).message_files

      expect(messageFiles).toHaveLength(1)
      expect(messageFiles[0]).toEqual(expect.objectContaining({
        id: 'file-vision-1',
        name: 'generated.png',
        type: 'image/png',
        transferMethod: TransferMethod.remote_url,
        supportFileType: 'image',
        uploadedId: 'upload-vision-1',
      }))
    })

    it('matches VisionFile payloads by upload_file_id when id is missing', () => {
      const visionFile: VisionFile = {
        type: 'document',
        transfer_method: TransferMethod.remote_url,
        url: 'https://example.com/',
        upload_file_id: 'upload-vision-fallback',
      }

      const items = [{ id: '1', files: ['upload-vision-fallback'] }] as unknown as ThoughtItem[]

      const result = addFileInfos(items, [visionFile])
      const messageFiles = (result[0] as ThoughtItem & { message_files: FileEntity[] }).message_files

      expect(messageFiles).toHaveLength(1)
      expect(messageFiles[0]).toEqual(expect.objectContaining({
        id: 'upload-vision-fallback',
        name: 'generated_file.bin',
        type: 'application/octet-stream',
        transferMethod: TransferMethod.remote_url,
        supportFileType: 'document',
        uploadedId: 'upload-vision-fallback',
      }))
    })

    it('returns items without files unchanged', () => {
      const items = [
        { id: '1' },
        { id: '2', files: null },
      ] as unknown as ThoughtItem[]
      const result = addFileInfos(items, [])
      expect(result[0]).toEqual(expect.objectContaining({ id: '1' }))
    })

    it('does not mutate original items', () => {
      const file1 = createFileEntity({ id: 'file-1', name: 'doc.pdf', type: 'application/pdf' })
      const items = [{ id: '1', files: ['file-1'] }] as unknown as ThoughtItem[]
      const result = addFileInfos(items, [file1])
      expect(result[0]).not.toBe(items[0])
    })
  })
})
