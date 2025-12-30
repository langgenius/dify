import type { UrlUpdateEvent } from 'nuqs/adapters/testing'
import type { ReactNode } from 'react'
/**
 * Test suite for useAppsQueryState hook
 *
 * This hook manages app filtering state through URL search parameters, enabling:
 * - Bookmarkable filter states (users can share URLs with specific filters active)
 * - Browser history integration (back/forward buttons work with filters)
 * - Multiple filter types: tagIDs, keywords, isCreatedByMe
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import useAppsQueryState from './use-apps-query-state'

const renderWithAdapter = (searchParams = '') => {
  const onUrlUpdate = vi.fn<(event: UrlUpdateEvent) => void>()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <NuqsTestingAdapter searchParams={searchParams} onUrlUpdate={onUrlUpdate}>
      {children}
    </NuqsTestingAdapter>
  )
  const { result } = renderHook(() => useAppsQueryState(), { wrapper })
  return { result, onUrlUpdate }
}

// Groups scenarios for useAppsQueryState behavior.
describe('useAppsQueryState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Covers the hook return shape and default values.
  describe('Initialization', () => {
    it('should expose query and setQuery when initialized', () => {
      const { result } = renderWithAdapter()

      expect(result.current.query).toBeDefined()
      expect(typeof result.current.setQuery).toBe('function')
    })

    it('should default to empty filters when search params are missing', () => {
      const { result } = renderWithAdapter()

      expect(result.current.query.tagIDs).toBeUndefined()
      expect(result.current.query.keywords).toBeUndefined()
      expect(result.current.query.isCreatedByMe).toBe(false)
    })
  })

  // Covers parsing of existing URL search params.
  describe('Parsing search params', () => {
    it('should parse tagIDs when URL includes tagIDs', () => {
      const { result } = renderWithAdapter('?tagIDs=tag1;tag2;tag3')

      expect(result.current.query.tagIDs).toEqual(['tag1', 'tag2', 'tag3'])
    })

    it('should parse keywords when URL includes keywords', () => {
      const { result } = renderWithAdapter('?keywords=search+term')

      expect(result.current.query.keywords).toBe('search term')
    })

    it('should parse isCreatedByMe when URL includes true value', () => {
      const { result } = renderWithAdapter('?isCreatedByMe=true')

      expect(result.current.query.isCreatedByMe).toBe(true)
    })

    it('should parse all params when URL includes multiple filters', () => {
      const { result } = renderWithAdapter(
        '?tagIDs=tag1;tag2&keywords=test&isCreatedByMe=true',
      )

      expect(result.current.query.tagIDs).toEqual(['tag1', 'tag2'])
      expect(result.current.query.keywords).toBe('test')
      expect(result.current.query.isCreatedByMe).toBe(true)
    })
  })

  // Covers updates driven by setQuery.
  describe('Updating query state', () => {
    it('should update keywords when setQuery receives keywords', () => {
      const { result } = renderWithAdapter()

      act(() => {
        result.current.setQuery({ keywords: 'new search' })
      })

      expect(result.current.query.keywords).toBe('new search')
    })

    it('should update tagIDs when setQuery receives tagIDs', () => {
      const { result } = renderWithAdapter()

      act(() => {
        result.current.setQuery({ tagIDs: ['tag1', 'tag2'] })
      })

      expect(result.current.query.tagIDs).toEqual(['tag1', 'tag2'])
    })

    it('should update isCreatedByMe when setQuery receives true', () => {
      const { result } = renderWithAdapter()

      act(() => {
        result.current.setQuery({ isCreatedByMe: true })
      })

      expect(result.current.query.isCreatedByMe).toBe(true)
    })

    it('should support partial updates when setQuery uses callback', () => {
      const { result } = renderWithAdapter()

      act(() => {
        result.current.setQuery({ keywords: 'initial' })
      })

      act(() => {
        result.current.setQuery(prev => ({ ...prev, isCreatedByMe: true }))
      })

      expect(result.current.query.keywords).toBe('initial')
      expect(result.current.query.isCreatedByMe).toBe(true)
    })
  })

  // Covers URL updates triggered by query changes.
  describe('URL synchronization', () => {
    it('should sync keywords to URL when keywords change', async () => {
      const { result, onUrlUpdate } = renderWithAdapter()

      act(() => {
        result.current.setQuery({ keywords: 'search' })
      })

      await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
      const update = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1][0]
      expect(update.searchParams.get('keywords')).toBe('search')
      expect(update.options.history).toBe('push')
    })

    it('should sync tagIDs to URL when tagIDs change', async () => {
      const { result, onUrlUpdate } = renderWithAdapter()

      act(() => {
        result.current.setQuery({ tagIDs: ['tag1', 'tag2'] })
      })

      await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
      const update = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1][0]
      expect(update.searchParams.get('tagIDs')).toBe('tag1;tag2')
    })

    it('should sync isCreatedByMe to URL when enabled', async () => {
      const { result, onUrlUpdate } = renderWithAdapter()

      act(() => {
        result.current.setQuery({ isCreatedByMe: true })
      })

      await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
      const update = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1][0]
      expect(update.searchParams.get('isCreatedByMe')).toBe('true')
    })

    it('should remove keywords from URL when keywords are cleared', async () => {
      const { result, onUrlUpdate } = renderWithAdapter('?keywords=existing')

      act(() => {
        result.current.setQuery({ keywords: '' })
      })

      await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
      const update = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1][0]
      expect(update.searchParams.has('keywords')).toBe(false)
    })

    it('should remove tagIDs from URL when tagIDs are empty', async () => {
      const { result, onUrlUpdate } = renderWithAdapter('?tagIDs=tag1;tag2')

      act(() => {
        result.current.setQuery({ tagIDs: [] })
      })

      await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
      const update = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1][0]
      expect(update.searchParams.has('tagIDs')).toBe(false)
    })

    it('should remove isCreatedByMe from URL when disabled', async () => {
      const { result, onUrlUpdate } = renderWithAdapter('?isCreatedByMe=true')

      act(() => {
        result.current.setQuery({ isCreatedByMe: false })
      })

      await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
      const update = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1][0]
      expect(update.searchParams.has('isCreatedByMe')).toBe(false)
    })
  })

  // Covers decoding and empty values.
  describe('Edge cases', () => {
    it('should treat empty tagIDs as empty list when URL param is empty', () => {
      const { result } = renderWithAdapter('?tagIDs=')

      expect(result.current.query.tagIDs).toEqual([])
    })

    it('should treat empty keywords as undefined when URL param is empty', () => {
      const { result } = renderWithAdapter('?keywords=')

      expect(result.current.query.keywords).toBeUndefined()
    })

    it('should decode keywords with spaces when URL contains encoded spaces', () => {
      const { result } = renderWithAdapter('?keywords=test+with+spaces')

      expect(result.current.query.keywords).toBe('test with spaces')
    })
  })

  // Covers multi-step updates that mimic real usage.
  describe('Integration scenarios', () => {
    it('should keep accumulated filters when updates are sequential', () => {
      const { result } = renderWithAdapter()

      act(() => {
        result.current.setQuery({ keywords: 'first' })
      })

      act(() => {
        result.current.setQuery(prev => ({ ...prev, tagIDs: ['tag1'] }))
      })

      act(() => {
        result.current.setQuery(prev => ({ ...prev, isCreatedByMe: true }))
      })

      expect(result.current.query.keywords).toBe('first')
      expect(result.current.query.tagIDs).toEqual(['tag1'])
      expect(result.current.query.isCreatedByMe).toBe(true)
    })
  })
})
