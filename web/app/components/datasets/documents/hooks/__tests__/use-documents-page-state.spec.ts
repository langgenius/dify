import { act, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'
import { renderHookWithNuqs } from '@/test/nuqs-testing'
import { useDocumentsPageState } from '../use-documents-page-state'

describe('useDocumentsPageState', () => {
  it('maps a bookmarked page and legacy enabled filter to the document query', () => {
    const { result } = renderHookWithNuqs(() => useDocumentsPageState(), {
      searchParams: '?page=3&limit=25&keyword=initial&status=enabled&sort=hit_count',
    })
    expect(result.current.currPage).toBe(2)
    expect(result.current.limit).toBe(25)
    expect(result.current.inputValue).toBe('initial')
    expect(result.current.normalizedStatusFilterValue).toBe('available')
    expect(result.current.sortValue).toBe('hit_count')
  })

  it.each([
    ['same', ['doc-1']],
    ['changed', []],
  ] as const)(
    'searching for %s resets pagination and preserves selection only for an unchanged keyword',
    async (keyword, selection) => {
      const { result, onUrlUpdate } = renderHookWithNuqs(() => useDocumentsPageState(), {
        searchParams: '?page=3&keyword=same',
      })
      act(() => result.current.setSelectedIds(['doc-1']))
      act(() => result.current.handleInputChange(keyword))
      expect(result.current.selectedIds).toEqual(selection)
      await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
      const params = onUrlUpdate.mock.calls.at(-1)![0].searchParams
      expect(params.get('keyword')).toBe(keyword)
      expect(params.get('page')).toBeNull()
    },
  )

  it.each(['change', 'clear'] as const)(
    '%s status resets the page and selection',
    async (action) => {
      const { result, onUrlUpdate } = renderHookWithNuqs(() => useDocumentsPageState(), {
        searchParams: '?page=3&status=error',
      })
      act(() => result.current.setSelectedIds(['doc-1']))
      act(() => {
        if (action === 'clear') result.current.handleStatusFilterClear()
        else result.current.handleStatusFilterChange('enabled')
      })
      expect(result.current.selectedIds).toEqual([])
      await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
      const params = onUrlUpdate.mock.calls.at(-1)![0].searchParams
      expect(params.get('page')).toBeNull()
      expect(params.get('status')).toBe(action === 'clear' ? null : 'enabled')
    },
  )

  it('converts zero-based pagination and resets it after changing the page size or sort', async () => {
    const { result, onUrlUpdate } = renderHookWithNuqs(() => useDocumentsPageState())
    act(() => result.current.handlePageChange(2))
    await waitFor(() =>
      expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get('page')).toBe('3'),
    )
    expect(result.current.currPage).toBe(2)
    act(() => result.current.handleLimitChange(25))
    await waitFor(() =>
      expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get('limit')).toBe('25'),
    )
    expect(onUrlUpdate.mock.calls.at(-1)![0].searchParams.get('page')).toBeNull()
    act(() => result.current.handlePageChange(2))
    await waitFor(() =>
      expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get('page')).toBe('3'),
    )
    act(() => result.current.handleSortChange('hit_count'))
    await waitFor(() =>
      expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get('sort')).toBe('hit_count'),
    )
    expect(onUrlUpdate.mock.calls.at(-1)![0].searchParams.get('page')).toBeNull()
  })
})
