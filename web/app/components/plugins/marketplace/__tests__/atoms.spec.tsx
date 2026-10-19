import type { ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { Provider as JotaiProvider } from 'jotai'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import {
  useMarketplaceMoreClick,
  useMarketplaceSearchMode,
  useMarketplaceSort,
  useMarketplaceSortValue,
  useSearchPluginText,
} from '../atoms'
import { DEFAULT_SORT } from '../constants'

const createWrapper = (searchParams = '') => {
  const { wrapper: NuqsWrapper, onUrlUpdate } = createNuqsTestWrapper({ searchParams })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <JotaiProvider>
      <NuqsWrapper>{children}</NuqsWrapper>
    </JotaiProvider>
  )
  return { wrapper, onUrlUpdate }
}

it.each([
  ['?category=all', false],
  ['?q=test&category=all', true],
  ['?tags=search&category=all', true],
  ['?category=model', true],
  ['?category=tool', false],
] as const)('derives search mode from %s', (params, expected) => {
  const { wrapper } = createWrapper(params)
  const { result } = renderHook(() => useMarketplaceSearchMode(), { wrapper })
  expect(result.current).toBe(expected)
})

it('uses the debounced query override before switching from collections to search', () => {
  const { wrapper } = createWrapper('?q=typing&category=tool')
  const { result, rerender } = renderHook(
    ({ query }) => useMarketplaceSearchMode(undefined, query),
    {
      wrapper,
      initialProps: { query: '' },
    },
  )
  expect(result.current).toBe(false)
  rerender({ query: 'typing' })
  expect(result.current).toBe(true)
})

it('applies a collection query and sort while preserving unrelated URL filters', async () => {
  const { wrapper, onUrlUpdate } = createWrapper('?category=tool&tags=search')
  const { result } = renderHook(
    () => ({
      more: useMarketplaceMoreClick(),
      sort: useMarketplaceSortValue(),
      query: useSearchPluginText()[0],
    }),
    { wrapper },
  )
  await act(async () => {
    result.current.more({ query: 'collection search', sort_by: 'created_at', sort_order: 'ASC' })
  })
  expect(result.current.sort).toEqual({ sortBy: 'created_at', sortOrder: 'ASC' })
  expect(result.current.query).toBe('collection search')
  await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
  const params = onUrlUpdate.mock.lastCall![0].searchParams
  expect(params.get('q')).toBe('collection search')
  expect(params.get('category')).toBe('tool')
  expect(params.get('tags')).toBe('search')
})

it('clears the previous query and sort but keeps search active for an unfiltered collection', async () => {
  const { wrapper, onUrlUpdate } = createWrapper('?q=previous&category=tool')
  const { result } = renderHook(
    () => ({
      more: useMarketplaceMoreClick(),
      sort: useMarketplaceSort(),
      query: useSearchPluginText()[0],
      searchMode: useMarketplaceSearchMode(),
    }),
    { wrapper },
  )
  act(() => result.current.sort[1]({ sortBy: 'created_at', sortOrder: 'ASC' }))
  await act(async () => result.current.more({}))
  expect(result.current.sort[0]).toEqual(DEFAULT_SORT)
  expect(result.current.query).toBe('')
  expect(result.current.searchMode).toBe(true)
  await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
  expect(onUrlUpdate.mock.lastCall![0].searchParams.has('q')).toBe(false)
})
