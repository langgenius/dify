import { addRecentItem, getRecentItems } from '../recent-store'

describe('recent-store', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  describe('getRecentItems', () => {
    it('returns an empty array when nothing is stored', () => {
      expect(getRecentItems()).toEqual([])
    })

    it('parses stored items from localStorage', () => {
      const items = [
        { id: 'app-1', title: 'App 1', path: '/app/1', originalType: 'app' as const },
      ]
      localStorage.setItem('goto-anything:recent', JSON.stringify(items))

      expect(getRecentItems()).toEqual(items)
    })

    it('returns an empty array when stored JSON is invalid', () => {
      localStorage.setItem('goto-anything:recent', 'not-json')

      expect(getRecentItems()).toEqual([])
    })

    it('returns an empty array when localStorage throws', () => {
      const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('boom')
      })

      expect(getRecentItems()).toEqual([])
      spy.mockRestore()
    })
  })

  describe('addRecentItem', () => {
    it('prepends a new item to the stored list', () => {
      addRecentItem({ id: 'a', title: 'A', path: '/a', originalType: 'app' })
      addRecentItem({ id: 'b', title: 'B', path: '/b', originalType: 'knowledge' })

      const stored = getRecentItems()
      expect(stored.map(i => i.id)).toEqual(['b', 'a'])
    })

    it('deduplicates by id, moving the existing entry to the front', () => {
      addRecentItem({ id: 'a', title: 'A', path: '/a', originalType: 'app' })
      addRecentItem({ id: 'b', title: 'B', path: '/b', originalType: 'app' })
      addRecentItem({ id: 'a', title: 'A updated', path: '/a', originalType: 'app' })

      const stored = getRecentItems()
      expect(stored.map(i => i.id)).toEqual(['a', 'b'])
      expect(stored[0]!.title).toBe('A updated')
    })

    it('caps the list at 8 items, evicting the oldest', () => {
      for (let i = 0; i < 10; i++)
        addRecentItem({ id: `item-${i}`, title: `Item ${i}`, path: `/i/${i}`, originalType: 'app' })

      const stored = getRecentItems()
      expect(stored).toHaveLength(8)
      expect(stored[0]!.id).toBe('item-9')
      expect(stored[7]!.id).toBe('item-2')
    })

    it('silently swallows storage errors', () => {
      const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('quota')
      })

      expect(() =>
        addRecentItem({ id: 'x', title: 'X', path: '/x', originalType: 'app' }),
      ).not.toThrow()
      spy.mockRestore()
    })
  })
})
