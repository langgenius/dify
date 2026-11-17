import { act, waitFor } from '@testing-library/react'
import { renderHookWithNuqs } from '@/test/nuqs-testing'
import { SNIPPET_LIST_SEARCH_DEBOUNCE_MS } from '../../constants'
import { useSnippetsQueryState } from '../use-snippets-query-state'

const renderWithAdapter = (searchParams = '') => {
  return renderHookWithNuqs(() => useSnippetsQueryState(), { searchParams })
}

describe('useSnippetsQueryState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('parses all list filters from the URL', () => {
    const { result } = renderWithAdapter(
      '?tagIDs=tag1;tag2&keywords=search+term&creatorIDs=creator-1;creator-2&publishStatus=draft',
    )

    expect(result.current.query).toEqual({
      tagIDs: ['tag1', 'tag2'],
      keywords: 'search term',
      creatorIDs: ['creator-1', 'creator-2'],
      publishStatus: 'draft',
    })
  })

  it('should update tag IDs URL state', async () => {
    const { result, onUrlUpdate } = renderWithAdapter()
    expect(result.current.query).toEqual({
      tagIDs: [],
      keywords: '',
      creatorIDs: [],
      publishStatus: 'all',
    })

    act(() => {
      result.current.setTagIDs(['tag1', 'tag2'])
    })

    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
    const update = onUrlUpdate.mock.calls.at(-1)![0]
    expect(result.current.query.tagIDs).toEqual(['tag1', 'tag2'])
    expect(update.searchParams.get('tagIDs')).toBe('tag1;tag2')
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
        await vi.advanceTimersByTimeAsync(SNIPPET_LIST_SEARCH_DEBOUNCE_MS + 100)
      })

      expect(onUrlUpdate).toHaveBeenCalled()
      const update = onUrlUpdate.mock.calls.at(-1)![0]
      expect(update.searchParams.get('keywords')).toBe('search')
    } finally {
      vi.useRealTimers()
    }
  })

  it('writes creator IDs to the URL and removes them when cleared', async () => {
    const { result, onUrlUpdate } = renderWithAdapter()

    act(() => {
      result.current.setCreatorIDs(['creator-1', 'creator-2'])
    })

    expect(result.current.query.creatorIDs).toEqual(['creator-1', 'creator-2'])
    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
    expect(onUrlUpdate.mock.lastCall?.[0].searchParams.get('creatorIDs')).toBe(
      'creator-1;creator-2',
    )
    await act(async () => result.current.setCreatorIDs([]))
    await waitFor(() =>
      expect(onUrlUpdate.mock.lastCall?.[0].searchParams.has('creatorIDs')).toBe(false),
    )
  })

  it('writes publication status to the URL and removes the default', async () => {
    const { result, onUrlUpdate } = renderWithAdapter()
    await act(async () => result.current.setPublishStatus('draft'))
    await waitFor(() =>
      expect(onUrlUpdate.mock.lastCall?.[0].searchParams.get('publishStatus')).toBe('draft'),
    )
    await act(async () => result.current.setPublishStatus('all'))
    await waitFor(() =>
      expect(onUrlUpdate.mock.lastCall?.[0].searchParams.has('publishStatus')).toBe(false),
    )
  })

  it('ignores an invalid publication status', () => {
    const { result } = renderWithAdapter('?publishStatus=invalid')
    expect(result.current.query.publishStatus).toBe('all')
  })

  it('commits pending search before navigation and cancels the delayed write', async () => {
    vi.useFakeTimers()
    try {
      const { result, onUrlUpdate } = renderWithAdapter()
      act(() => result.current.setKeywords('sales'))
      expect(onUrlUpdate).not.toHaveBeenCalled()
      await act(async () => {
        const pending = result.current.flush()
        await vi.runAllTimersAsync()
        await pending
      })
      expect(onUrlUpdate).toHaveBeenCalledOnce()
      expect(onUrlUpdate.mock.lastCall?.[0].searchParams.get('keywords')).toBe('sales')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(SNIPPET_LIST_SEARCH_DEBOUNCE_MS + 100)
      })
      expect(onUrlUpdate).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })
})
