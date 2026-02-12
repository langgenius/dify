import type { OnlineDriveData } from '@/types/pipeline'
import { describe, expect, it } from 'vitest'
import { OnlineDriveFileType } from '@/models/pipeline'
import { convertOnlineDriveData, isBucketListInitiation, isFile } from '../utils'

describe('online-drive utils', () => {
  describe('isFile', () => {
    it('should return true for file type', () => {
      expect(isFile('file')).toBe(true)
    })

    it('should return false for folder type', () => {
      expect(isFile('folder')).toBe(false)
    })
  })

  describe('isBucketListInitiation', () => {
    it('should return true when data has buckets and no prefix/bucket set', () => {
      const data = [
        { bucket: 'bucket-1', files: [], is_truncated: false, next_page_parameters: {} },
        { bucket: 'bucket-2', files: [], is_truncated: false, next_page_parameters: {} },
      ] as OnlineDriveData[]

      expect(isBucketListInitiation(data, [], '')).toBe(true)
    })

    it('should return false when bucket is already set', () => {
      const data = [
        { bucket: 'bucket-1', files: [], is_truncated: false, next_page_parameters: {} },
      ] as OnlineDriveData[]

      expect(isBucketListInitiation(data, [], 'bucket-1')).toBe(false)
    })

    it('should return false when prefix is set', () => {
      const data = [
        { bucket: 'bucket-1', files: [], is_truncated: false, next_page_parameters: {} },
      ] as OnlineDriveData[]

      expect(isBucketListInitiation(data, ['folder/'], '')).toBe(false)
    })

    it('should return false when single bucket has files', () => {
      const data = [
        {
          bucket: 'bucket-1',
          files: [{ id: 'f1', name: 'test.txt', size: 100, type: 'file' as const }],
          is_truncated: false,
          next_page_parameters: {},
        },
      ] as OnlineDriveData[]

      expect(isBucketListInitiation(data, [], '')).toBe(false)
    })
  })

  describe('convertOnlineDriveData', () => {
    it('should return empty result for empty data', () => {
      const result = convertOnlineDriveData([], [], '')
      expect(result.fileList).toEqual([])
      expect(result.isTruncated).toBe(false)
      expect(result.hasBucket).toBe(false)
    })

    it('should convert bucket list initiation to bucket items', () => {
      const data = [
        { bucket: 'bucket-1', files: [], is_truncated: false, next_page_parameters: {} },
        { bucket: 'bucket-2', files: [], is_truncated: false, next_page_parameters: {} },
      ] as OnlineDriveData[]

      const result = convertOnlineDriveData(data, [], '')
      expect(result.fileList).toHaveLength(2)
      expect(result.fileList[0]).toEqual({
        id: 'bucket-1',
        name: 'bucket-1',
        type: OnlineDriveFileType.bucket,
      })
      expect(result.hasBucket).toBe(true)
    })

    it('should convert files when not bucket list', () => {
      const data = [
        {
          bucket: 'bucket-1',
          files: [
            { id: 'f1', name: 'test.txt', size: 100, type: 'file' as const },
            { id: 'f2', name: 'folder', size: 0, type: 'folder' as const },
          ],
          is_truncated: true,
          next_page_parameters: { token: 'next' },
        },
      ] as OnlineDriveData[]

      const result = convertOnlineDriveData(data, [], 'bucket-1')
      expect(result.fileList).toHaveLength(2)
      expect(result.fileList[0].type).toBe(OnlineDriveFileType.file)
      expect(result.fileList[0].size).toBe(100)
      expect(result.fileList[1].type).toBe(OnlineDriveFileType.folder)
      expect(result.fileList[1].size).toBeUndefined()
      expect(result.isTruncated).toBe(true)
      expect(result.nextPageParameters).toEqual({ token: 'next' })
      expect(result.hasBucket).toBe(true)
    })
  })
})
