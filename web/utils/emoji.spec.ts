import type { Mock } from 'vitest'
import { SearchIndex } from 'emoji-mart'
import { searchEmoji } from './emoji'

vi.mock('emoji-mart', () => ({
  SearchIndex: {
    search: vi.fn(),
  },
}))

describe('Emoji Utilities', () => {
  describe('searchEmoji', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('should return emoji natives for search results', async () => {
      const mockEmojis = [
        { skins: [{ native: '😀' }] },
        { skins: [{ native: '😃' }] },
        { skins: [{ native: '😄' }] },
      ]
      ;(SearchIndex.search as Mock).mockResolvedValue(mockEmojis)

      const result = await searchEmoji('smile')
      expect(result).toEqual(['😀', '😃', '😄'])
    })

    it('should return empty array when no results', async () => {
      ;(SearchIndex.search as Mock).mockResolvedValue([])

      const result = await searchEmoji('nonexistent')
      expect(result).toEqual([])
    })

    it('should return empty array when search returns null', async () => {
      ;(SearchIndex.search as Mock).mockResolvedValue(null)

      const result = await searchEmoji('test')
      expect(result).toEqual([])
    })

    it('should handle search with empty string', async () => {
      ;(SearchIndex.search as Mock).mockResolvedValue([])

      const result = await searchEmoji('')
      expect(result).toEqual([])
      expect(SearchIndex.search).toHaveBeenCalledWith('')
    })

    it('should extract native from first skin', async () => {
      const mockEmojis = [
        {
          skins: [
            { native: '👍' },
            { native: '👍🏻' },
            { native: '👍🏼' },
          ],
        },
      ]
      ;(SearchIndex.search as Mock).mockResolvedValue(mockEmojis)

      const result = await searchEmoji('thumbs')
      expect(result).toEqual(['👍'])
    })

    it('should handle multiple search terms', async () => {
      const mockEmojis = [
        { skins: [{ native: '❤️' }] },
        { skins: [{ native: '💙' }] },
      ]
      ;(SearchIndex.search as Mock).mockResolvedValue(mockEmojis)

      const result = await searchEmoji('heart love')
      expect(result).toEqual(['❤️', '💙'])
    })
  })
})
