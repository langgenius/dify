import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSearchFilter } from '../use-search-filter'

describe('useSearchFilter', () => {
  const onPageChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should initialize with default values', () => {
    const { result } = renderHook(() => useSearchFilter({ onPageChange }))

    expect(result.current.inputValue).toBe('')
    expect(result.current.searchValue).toBe('')
    expect(result.current.selectedStatus).toBe('all')
    expect(result.current.selectDefaultValue).toBe('all')
  })

  it('should provide status list with three items', () => {
    const { result } = renderHook(() => useSearchFilter({ onPageChange }))
    expect(result.current.statusList).toHaveLength(3)
  })

  it('should update input value immediately on handleInputChange', () => {
    const { result } = renderHook(() => useSearchFilter({ onPageChange }))

    act(() => {
      result.current.handleInputChange('test query')
    })

    expect(result.current.inputValue).toBe('test query')
  })

  it('should update search value after debounce', () => {
    const { result } = renderHook(() => useSearchFilter({ onPageChange }))

    act(() => {
      result.current.handleInputChange('debounced')
    })

    // Before debounce
    expect(result.current.searchValue).toBe('')

    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(result.current.searchValue).toBe('debounced')
    expect(onPageChange).toHaveBeenCalledWith(1)
  })

  it('should change status and reset page', () => {
    const { result } = renderHook(() => useSearchFilter({ onPageChange }))

    act(() => {
      result.current.onChangeStatus({ value: 1, name: 'Enabled' })
    })

    expect(result.current.selectedStatus).toBe(true)
    expect(result.current.selectDefaultValue).toBe(1)
    expect(onPageChange).toHaveBeenCalledWith(1)
  })

  it('should set status to false when value is 0', () => {
    const { result } = renderHook(() => useSearchFilter({ onPageChange }))

    act(() => {
      result.current.onChangeStatus({ value: 0, name: 'Disabled' })
    })

    expect(result.current.selectedStatus).toBe(false)
    expect(result.current.selectDefaultValue).toBe(0)
  })

  it('should set status to "all" when value is "all"', () => {
    const { result } = renderHook(() => useSearchFilter({ onPageChange }))

    act(() => {
      result.current.onChangeStatus({ value: 1, name: 'Enabled' })
    })
    act(() => {
      result.current.onChangeStatus({ value: 'all', name: 'All' })
    })

    expect(result.current.selectedStatus).toBe('all')
  })

  it('should clear all filters on onClearFilter', () => {
    const { result } = renderHook(() => useSearchFilter({ onPageChange }))

    act(() => {
      result.current.handleInputChange('test')
      vi.advanceTimersByTime(500)
    })
    act(() => {
      result.current.onChangeStatus({ value: 1, name: 'Enabled' })
    })

    act(() => {
      result.current.onClearFilter()
    })

    expect(result.current.inputValue).toBe('')
    expect(result.current.searchValue).toBe('')
    expect(result.current.selectedStatus).toBe('all')
  })

  it('should reset page on resetPage', () => {
    const { result } = renderHook(() => useSearchFilter({ onPageChange }))

    act(() => {
      result.current.resetPage()
    })

    expect(onPageChange).toHaveBeenCalledWith(1)
  })
})
