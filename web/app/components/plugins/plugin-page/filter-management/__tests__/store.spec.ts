import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from '../store'

describe('filter-management store', () => {
  beforeEach(() => {
    // Reset store to default state
    const { result } = renderHook(() => useStore())
    act(() => {
      result.current.setTagList([])
      result.current.setCategoryList([])
      result.current.setShowTagManagementModal(false)
      result.current.setShowCategoryManagementModal(false)
    })
  })

  it('should initialize with default values', () => {
    const { result } = renderHook(() => useStore())

    expect(result.current.tagList).toEqual([])
    expect(result.current.categoryList).toEqual([])
    expect(result.current.showTagManagementModal).toBe(false)
    expect(result.current.showCategoryManagementModal).toBe(false)
  })

  it('should set tag list', () => {
    const { result } = renderHook(() => useStore())
    const tags = [{ name: 'tag1', label: { en_US: 'Tag 1' } }]

    act(() => {
      result.current.setTagList(tags as never[])
    })

    expect(result.current.tagList).toEqual(tags)
  })

  it('should set category list', () => {
    const { result } = renderHook(() => useStore())
    const categories = [{ name: 'cat1', label: { en_US: 'Cat 1' } }]

    act(() => {
      result.current.setCategoryList(categories as never[])
    })

    expect(result.current.categoryList).toEqual(categories)
  })

  it('should toggle tag management modal', () => {
    const { result } = renderHook(() => useStore())

    act(() => {
      result.current.setShowTagManagementModal(true)
    })
    expect(result.current.showTagManagementModal).toBe(true)

    act(() => {
      result.current.setShowTagManagementModal(false)
    })
    expect(result.current.showTagManagementModal).toBe(false)
  })

  it('should toggle category management modal', () => {
    const { result } = renderHook(() => useStore())

    act(() => {
      result.current.setShowCategoryManagementModal(true)
    })
    expect(result.current.showCategoryManagementModal).toBe(true)

    act(() => {
      result.current.setShowCategoryManagementModal(false)
    })
    expect(result.current.showCategoryManagementModal).toBe(false)
  })

  it('should handle undefined tag list', () => {
    const { result } = renderHook(() => useStore())

    act(() => {
      result.current.setTagList(undefined)
    })

    expect(result.current.tagList).toBeUndefined()
  })
})
