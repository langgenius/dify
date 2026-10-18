import { describe, expect, it } from 'vite-plus/test'
import { createChatFileFixture, createChatThoughtFixture } from '@/test/fixtures/chat'
import { addFileInfos, sortAgentSorts } from '../index'

describe('tools/utils', () => {
  describe('sortAgentSorts', () => {
    it('sorts items by position ascending', () => {
      const items = [
        createChatThoughtFixture({ id: 'c', position: 3 }),
        createChatThoughtFixture({ id: 'a', position: 1 }),
        createChatThoughtFixture({ id: 'b', position: 2 }),
      ]
      const result = sortAgentSorts(items)
      expect(result.map((item) => item.id)).toEqual(['a', 'b', 'c'])
      expect(items.map((item) => item.id)).toEqual(['c', 'a', 'b'])
    })
  })

  describe('addFileInfos', () => {
    it('adds message_files by matching file IDs', () => {
      const file1 = createChatFileFixture({ id: 'file-1', name: 'doc.pdf' })
      const file2 = createChatFileFixture({ id: 'file-2', name: 'img.png' })
      const items = [
        createChatThoughtFixture({ id: '1', files: ['file-2', 'file-1'] }),
        createChatThoughtFixture({ id: '2', files: [] }),
      ]

      const result = addFileInfos(items, [file1, file2])
      expect(result[0]?.message_files).toEqual([file2, file1])
      expect(result[1]).toEqual(items[1])
      expect(items[0]).not.toHaveProperty('message_files')
    })

    it('returns items without files unchanged', () => {
      const items = [
        createChatThoughtFixture({ id: '1' }),
        createChatThoughtFixture({ id: '2', files: [] }),
      ]
      const result = addFileInfos(items, [])
      expect(result).toEqual(items)
    })
  })
})
