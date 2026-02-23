import type { ThoughtItem } from '@/app/components/base/chat/chat/type'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import { describe, expect, it } from 'vitest'
import { addFileInfos, sortAgentSorts } from '../index'

describe('tools/utils', () => {
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
      const file1 = { id: 'file-1', name: 'doc.pdf' } as FileEntity
      const file2 = { id: 'file-2', name: 'img.png' } as FileEntity
      const items = [
        { id: '1', files: ['file-1', 'file-2'] },
        { id: '2', files: [] },
      ] as unknown as ThoughtItem[]

      const result = addFileInfos(items, [file1, file2])
      expect((result[0] as ThoughtItem & { message_files: FileEntity[] }).message_files).toEqual([file1, file2])
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
      const file1 = { id: 'file-1', name: 'doc.pdf' } as FileEntity
      const items = [{ id: '1', files: ['file-1'] }] as unknown as ThoughtItem[]
      const result = addFileInfos(items, [file1])
      expect(result[0]).not.toBe(items[0])
    })
  })
})
