import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from '@/app/components/plugins/plugin-page/filter-management/store'

describe('Plugin Page Filter Management Integration', () => {
  beforeEach(() => {
    const { result } = renderHook(() => useStore())
    act(() => {
      result.current.setTagList([])
      result.current.setCategoryList([])
      result.current.setShowTagManagementModal(false)
      result.current.setShowCategoryManagementModal(false)
    })
  })

  describe('tag and category filter lifecycle', () => {
    it('should manage full tag lifecycle: add -> update -> clear', () => {
      const { result } = renderHook(() => useStore())

      const initialTags = [
        { name: 'search', label: { en_US: 'Search' } },
        { name: 'productivity', label: { en_US: 'Productivity' } },
      ]

      act(() => {
        result.current.setTagList(initialTags as never[])
      })
      expect(result.current.tagList).toHaveLength(2)

      const updatedTags = [
        ...initialTags,
        { name: 'image', label: { en_US: 'Image' } },
      ]

      act(() => {
        result.current.setTagList(updatedTags as never[])
      })
      expect(result.current.tagList).toHaveLength(3)

      act(() => {
        result.current.setTagList([])
      })
      expect(result.current.tagList).toHaveLength(0)
    })

    it('should manage full category lifecycle: add -> update -> clear', () => {
      const { result } = renderHook(() => useStore())

      const categories = [
        { name: 'tool', label: { en_US: 'Tool' } },
        { name: 'model', label: { en_US: 'Model' } },
      ]

      act(() => {
        result.current.setCategoryList(categories as never[])
      })
      expect(result.current.categoryList).toHaveLength(2)

      act(() => {
        result.current.setCategoryList([])
      })
      expect(result.current.categoryList).toHaveLength(0)
    })
  })

  describe('modal state management', () => {
    it('should manage tag management modal independently', () => {
      const { result } = renderHook(() => useStore())

      act(() => {
        result.current.setShowTagManagementModal(true)
      })
      expect(result.current.showTagManagementModal).toBe(true)
      expect(result.current.showCategoryManagementModal).toBe(false)

      act(() => {
        result.current.setShowTagManagementModal(false)
      })
      expect(result.current.showTagManagementModal).toBe(false)
    })

    it('should manage category management modal independently', () => {
      const { result } = renderHook(() => useStore())

      act(() => {
        result.current.setShowCategoryManagementModal(true)
      })
      expect(result.current.showCategoryManagementModal).toBe(true)
      expect(result.current.showTagManagementModal).toBe(false)
    })

    it('should support both modals open simultaneously', () => {
      const { result } = renderHook(() => useStore())

      act(() => {
        result.current.setShowTagManagementModal(true)
        result.current.setShowCategoryManagementModal(true)
      })

      expect(result.current.showTagManagementModal).toBe(true)
      expect(result.current.showCategoryManagementModal).toBe(true)
    })
  })

  describe('state persistence across renders', () => {
    it('should maintain filter state when re-rendered', () => {
      const { result, rerender } = renderHook(() => useStore())

      act(() => {
        result.current.setTagList([{ name: 'search' }] as never[])
        result.current.setCategoryList([{ name: 'tool' }] as never[])
      })

      rerender()

      expect(result.current.tagList).toHaveLength(1)
      expect(result.current.categoryList).toHaveLength(1)
    })
  })
})
