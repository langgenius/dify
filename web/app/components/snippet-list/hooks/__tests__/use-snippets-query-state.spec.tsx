import { act, waitFor } from '@testing-library/react'
import { renderHookWithNuqs } from '@/test/nuqs-testing'
import { SNIPPET_LIST_SEARCH_DEBOUNCE_MS } from '../../constants'
import { useSnippetsQueryState } from '../use-snippets-query-state'

const renderWithAdapter = (searchParams = '') => {
  // eslint-disable-next-line eslint-react/use-state -- renderHook executes a custom hook, not React.useState
  return renderHookWithNuqs(() => useSnippetsQueryState(), { searchParams })
}

describe('useSnippetsQueryState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should expose snippets list query state actions', () => {
    const { result } = renderWithAdapter()

    expect(result.current.query).toEqual({
      tagIDs: [],
      keywords: '',
      creatorIDs: [],
    })
    expect(typeof result.current.setKeywords).toBe('function')
    expect(typeof result.current.setTagIDs).toBe('function')
    expect(typeof result.current.setCreatorIDs).toBe('function')
  })

  it('should parse URL filters without creator state', () => {
    const { result } = renderWithAdapter('?tagIDs=tag1;tag2&keywords=search+term')

    expect(result.current.query).toEqual({
      tagIDs: ['tag1', 'tag2'],
      keywords: 'search term',
      creatorIDs: [],
    })
  })

  it('should update tag IDs URL state', async () => {
    const { result, onUrlUpdate } = renderWithAdapter()

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

  it('should update creator IDs in local state without writing to the URL', () => {
    const { result, onUrlUpdate } = renderWithAdapter()

    act(() => {
      result.current.setCreatorIDs(['creator-1', 'creator-2'])
    })

    expect(result.current.query.creatorIDs).toEqual(['creator-1', 'creator-2'])
    expect(onUrlUpdate).not.toHaveBeenCalled()
  })
})
