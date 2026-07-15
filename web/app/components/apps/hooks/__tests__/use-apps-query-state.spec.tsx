import { act, waitFor } from '@testing-library/react'
import { renderHookWithNuqs } from '@/test/nuqs-testing'
import { AppModeEnum } from '@/types/app'
import { APP_LIST_SEARCH_DEBOUNCE_MS } from '../../constants'
import { useAppsQueryState } from '../use-apps-query-state'

const renderWithAdapter = (searchParams = '') => {
  // oxlint-disable-next-line eslint-react/use-state -- renderHook executes a custom hook, not React.useState
  return renderHookWithNuqs(() => useAppsQueryState(), { searchParams })
}

describe('useAppsQueryState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should expose app list query state actions', () => {
    const { result } = renderWithAdapter()

    expect(result.current.query).toEqual({
      category: 'all',
      keywords: '',
      creatorIDs: [],
    })
    expect(typeof result.current.setCategory).toBe('function')
    expect(typeof result.current.setKeywords).toBe('function')
    expect(typeof result.current.setCreatorIDs).toBe('function')
  })

  it('should parse app list filters from URL', () => {
    const { result } = renderWithAdapter('?category=workflow&tagIDs=tag1;tag2&keywords=search+term')

    expect(result.current.query).toEqual({
      category: AppModeEnum.WORKFLOW,
      keywords: 'search term',
      creatorIDs: [],
    })
  })

  it('should update category URL state', async () => {
    const { result, onUrlUpdate } = renderWithAdapter()

    act(() => {
      result.current.setCategory(AppModeEnum.WORKFLOW)
    })

    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
    const update = onUrlUpdate.mock.calls.at(-1)![0]
    expect(result.current.query.category).toBe(AppModeEnum.WORKFLOW)
    expect(update.searchParams.get('category')).toBe(AppModeEnum.WORKFLOW)
    expect(update.options.history).toBe('push')
  })

  it('should remove category from URL when set to all', async () => {
    const { result, onUrlUpdate } = renderWithAdapter('?category=workflow')

    act(() => {
      result.current.setCategory('all')
    })

    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
    const update = onUrlUpdate.mock.calls.at(-1)![0]
    expect(result.current.query.category).toBe('all')
    expect(update.searchParams.has('category')).toBe(false)
  })

  it('should update keywords state immediately while debouncing URL writes', async () => {
    vi.useFakeTimers()
    try {
      const { result, onUrlUpdate } = renderWithAdapter()

      act(() => {
        result.current.setKeywords('search')
      })

      expect(result.current.query.keywords).toBe('search')
      expect(onUrlUpdate).not.toHaveBeenCalled()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(APP_LIST_SEARCH_DEBOUNCE_MS + 100)
      })

      expect(onUrlUpdate).toHaveBeenCalled()
      const update = onUrlUpdate.mock.calls.at(-1)![0]
      expect(update.searchParams.get('keywords')).toBe('search')
    } finally {
      vi.useRealTimers()
    }
  })

  it('should remove keywords from URL when cleared', async () => {
    vi.useFakeTimers()
    try {
      const { result, onUrlUpdate } = renderWithAdapter('?keywords=existing')

      act(() => {
        result.current.setKeywords('')
      })

      expect(result.current.query.keywords).toBe('')

      await act(async () => {
        await vi.advanceTimersByTimeAsync(APP_LIST_SEARCH_DEBOUNCE_MS + 100)
      })

      expect(onUrlUpdate).toHaveBeenCalled()
      const update = onUrlUpdate.mock.calls.at(-1)![0]
      expect(update.searchParams.has('keywords')).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('should update creator IDs in local state without writing to the URL', () => {
    const { result, onUrlUpdate } = renderWithAdapter()

    act(() => {
      result.current.setCreatorIDs(['creator-1', 'creator-2'])
    })

    expect(result.current.query.creatorIDs).toEqual(['creator-1', 'creator-2'])
    expect(onUrlUpdate).not.toHaveBeenCalled()
  })

  it('should clear creator IDs from local state without writing to the URL', () => {
    const { result, onUrlUpdate } = renderWithAdapter()

    act(() => {
      result.current.setCreatorIDs(['creator-1'])
    })

    act(() => {
      result.current.setCreatorIDs([])
    })

    expect(result.current.query.creatorIDs).toEqual([])
    expect(onUrlUpdate).not.toHaveBeenCalled()
  })
})
