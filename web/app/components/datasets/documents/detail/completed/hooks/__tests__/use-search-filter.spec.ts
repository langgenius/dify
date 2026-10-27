import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
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

  it('should update search value after debounce', () => {
    const { result } = renderHook(() => useSearchFilter({ onPageChange }))

    act(() => {
      result.current.handleInputChange('debounced')
    })

    expect(result.current.inputValue).toBe('debounced')
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
})
