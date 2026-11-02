import type { ThoughtItem } from '@/app/components/base/chat/chat/type'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import { describe, expect, it } from 'vite-plus/test'
import { addFileInfos, sortAgentSorts } from '../index'

describe('tools/utils', () => {
  describe('sortAgentSorts', () => {
    it('returns unsorted when some items lack position', () => {
      const items = [{ id: '1', position: 2 }, { id: '2' }] as unknown as ThoughtItem[]
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
      expect(result.map((item) => item.id)).toEqual(['a', 'b', 'c'])
      expect(items.map((item) => item.id)).toEqual(['c', 'a', 'b'])
    })
  })

  describe('addFileInfos', () => {
    it('adds message_files by matching file IDs', () => {
      const file1 = { id: 'file-1', name: 'doc.pdf' } as FileEntity
      const file2 = { id: 'file-2', name: 'img.png' } as FileEntity
      const items = [
        { id: '1', files: ['file-2', 'file-1'] },
        { id: '2', files: [] },
      ] as unknown as ThoughtItem[]

      const result = addFileInfos(items, [file1, file2])
      expect((result[0] as ThoughtItem & { message_files: FileEntity[] }).message_files).toEqual([
        file2,
        file1,
      ])
      expect(result[1]).toEqual(items[1])
      expect(items[0]).not.toHaveProperty('message_files')
    })

    it('returns items without files unchanged', () => {
      const items = [{ id: '1' }, { id: '2', files: [] }] as unknown as ThoughtItem[]
      const result = addFileInfos(items, [])
      expect(result).toEqual(items)
    })
  })
})
