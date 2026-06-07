import { act, renderHook, waitFor } from '@testing-library/react'
import { getNextRecentItems, useRecentItems } from '../use-recent-items'

describe('useRecentItems', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  describe('recent item updates', () => {
    it('should prepend a new item to recent items', async () => {
      const { result } = renderHook(() => useRecentItems())

      act(() => {
        result.current.addRecentItem({ id: 'a', title: 'A', path: '/a', originalType: 'app' })
        result.current.addRecentItem({ id: 'b', title: 'B', path: '/b', originalType: 'knowledge' })
      })

      await waitFor(() => {
        expect(result.current.recentItems.map(item => item.id)).toEqual(['b', 'a'])
      })
    })

    it('should read existing stored items from localStorage', () => {
      const items = [
        { id: 'app-1', title: 'App 1', path: '/app/1', originalType: 'app' as const },
      ]
      localStorage.setItem('goto-anything:recent', JSON.stringify(items))

      const { result } = renderHook(() => useRecentItems())

      expect(result.current.recentItems).toEqual(items)
    })

    it('should fall back to an empty array when stored JSON is invalid', () => {
      localStorage.setItem('goto-anything:recent', 'not-json')

      const { result } = renderHook(() => useRecentItems())

      expect(result.current.recentItems).toEqual([])
    })
  })

  describe('getNextRecentItems', () => {
    it('should deduplicate by id and move the latest entry to the front', () => {
      const result = getNextRecentItems(
        { id: 'a', title: 'A updated', path: '/a', originalType: 'app' },
        [
          { id: 'a', title: 'A', path: '/a', originalType: 'app' },
          { id: 'b', title: 'B', path: '/b', originalType: 'knowledge' },
        ],
      )

      expect(result.map(item => item.id)).toEqual(['a', 'b'])
      expect(result[0]!.title).toBe('A updated')
    })

    it('should cap the list at 8 items', () => {
      const recentItems = Array.from({ length: 10 }, (_, index) => ({
        id: `item-${index}`,
        title: `Item ${index}`,
        path: `/items/${index}`,
        originalType: 'app' as const,
      }))

      const result = getNextRecentItems(
        { id: 'latest', title: 'Latest', path: '/latest', originalType: 'app' },
        recentItems,
      )

      expect(result).toHaveLength(8)
      expect(result[0]!.id).toBe('latest')
      expect(result[7]!.id).toBe('item-6')
    })
  })
})
