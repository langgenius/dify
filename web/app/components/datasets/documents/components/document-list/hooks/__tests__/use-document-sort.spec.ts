import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useDocumentSort } from '../use-document-sort'

describe('useDocumentSort', () => {
  describe('remote state parsing', () => {
    it('should parse descending created_at sort', () => {
      const onRemoteSortChange = vi.fn()
      const { result } = renderHook(() => useDocumentSort({
        remoteSortValue: '-created_at',
        onRemoteSortChange,
      }))

      expect(result.current.sortField).toBe('created_at')
      expect(result.current.sortOrder).toBe('desc')
    })

    it('should parse ascending hit_count sort', () => {
      const onRemoteSortChange = vi.fn()
      const { result } = renderHook(() => useDocumentSort({
        remoteSortValue: 'hit_count',
        onRemoteSortChange,
      }))

      expect(result.current.sortField).toBe('hit_count')
      expect(result.current.sortOrder).toBe('asc')
    })

    it('should fallback to inactive field for unsupported sort key', () => {
      const onRemoteSortChange = vi.fn()
      const { result } = renderHook(() => useDocumentSort({
        remoteSortValue: '-name',
        onRemoteSortChange,
      }))

      expect(result.current.sortField).toBeNull()
      expect(result.current.sortOrder).toBe('desc')
    })
  })

  describe('handleSort', () => {
    it('should switch to desc when selecting a different field', () => {
      const onRemoteSortChange = vi.fn()
      const { result } = renderHook(() => useDocumentSort({
        remoteSortValue: '-created_at',
        onRemoteSortChange,
      }))

      act(() => {
        result.current.handleSort('hit_count')
      })

      expect(onRemoteSortChange).toHaveBeenCalledWith('-hit_count')
    })

    it('should toggle desc -> asc when clicking active field', () => {
      const onRemoteSortChange = vi.fn()
      const { result } = renderHook(() => useDocumentSort({
        remoteSortValue: '-hit_count',
        onRemoteSortChange,
      }))

      act(() => {
        result.current.handleSort('hit_count')
      })

      expect(onRemoteSortChange).toHaveBeenCalledWith('hit_count')
    })

    it('should toggle asc -> desc when clicking active field', () => {
      const onRemoteSortChange = vi.fn()
      const { result } = renderHook(() => useDocumentSort({
        remoteSortValue: 'created_at',
        onRemoteSortChange,
      }))

      act(() => {
        result.current.handleSort('created_at')
      })

      expect(onRemoteSortChange).toHaveBeenCalledWith('-created_at')
    })

    it('should ignore null field', () => {
      const onRemoteSortChange = vi.fn()
      const { result } = renderHook(() => useDocumentSort({
        remoteSortValue: '-created_at',
        onRemoteSortChange,
      }))

      act(() => {
        result.current.handleSort(null)
      })

      expect(onRemoteSortChange).not.toHaveBeenCalled()
    })
  })
})
