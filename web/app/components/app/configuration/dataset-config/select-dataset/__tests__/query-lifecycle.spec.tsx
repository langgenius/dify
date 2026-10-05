import type { DataSet, DataSetListResponse } from '@/models/datasets'
import { queryOptions, skipToken } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { SelectDataSet } from '../index'

const mockGet = vi.hoisted(() => vi.fn())
vi.mock('@/service/base', () => ({ get: mockGet, post: vi.fn() }))

const dataset = {
  id: 'dataset-one',
  name: 'Dataset One',
  provider: 'internal',
  indexing_technique: 'economy',
  embedding_available: true,
  icon_info: { icon_type: 'emoji', icon: '💾', icon_background: '#fff', icon_url: '' },
} as DataSet
const page = (pageNumber: number, hasMore: boolean): DataSetListResponse => ({
  data: pageNumber === 1 ? [dataset] : [],
  has_more: hasMore,
  page: pageNumber,
  limit: 20,
  total: 21,
})
const datasetQuery = queryOptions({
  queryKey: ['dataset', 'list', 'infinite', { page: 1 }],
  queryFn: skipToken,
})

describe('dataset selector query lifetime', () => {
  it('does not fetch while closed and refetches on each new session', async () => {
    mockGet.mockReset().mockResolvedValue(page(1, false))
    const { wrapper, queryClient } = createConsoleQueryWrapper()
    const props = { onOpenChange: vi.fn(), onSelect: vi.fn(), selectedIds: [] }
    const { rerender } = render(<SelectDataSet {...props} open={false} />, { wrapper })
    expect(mockGet).not.toHaveBeenCalled()
    rerender(<SelectDataSet {...props} open />)
    expect(await screen.findByText('Dataset One')).toBeInTheDocument()
    expect(mockGet).toHaveBeenCalledTimes(1)
    rerender(<SelectDataSet {...props} open={false} />)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: datasetQuery.queryKey })
    })
    expect(mockGet).toHaveBeenCalledTimes(1)
    rerender(<SelectDataSet {...props} open />)
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2))
  })

  it('finishes refreshing cached page one before requesting the next page on reopen', async () => {
    mockGet.mockReset()
    let resolveRefresh: (response: DataSetListResponse) => void = () => {}
    mockGet.mockImplementation((url: string) =>
      url === '/datasets?page=1'
        ? new Promise<DataSetListResponse>((resolve) => {
            resolveRefresh = resolve
          })
        : Promise.resolve(page(2, false)),
    )
    const { wrapper, queryClient } = createConsoleQueryWrapper()
    queryClient.setQueryData(datasetQuery.queryKey, { pages: [page(1, true)], pageParams: [1] })
    render(<SelectDataSet open onOpenChange={vi.fn()} onSelect={vi.fn()} selectedIds={[]} />, {
      wrapper,
    })
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/datasets?page=1'))
    expect(mockGet.mock.calls.map(([url]) => url)).toEqual(['/datasets?page=1'])
    await act(async () => resolveRefresh(page(1, false)))
    expect(screen.getByText('Dataset One')).toBeInTheDocument()
    expect(mockGet).toHaveBeenCalledTimes(1)
  })
  it('loads the next page on scroll after a cached refresh still reports more datasets', async () => {
    mockGet.mockReset()
    let resolveRefresh: (response: DataSetListResponse) => void = () => {}
    mockGet.mockImplementation((url: string) =>
      url === '/datasets?page=1'
        ? new Promise<DataSetListResponse>((resolve) => {
            resolveRefresh = resolve
          })
        : Promise.resolve(page(2, false)),
    )
    const { wrapper, queryClient } = createConsoleQueryWrapper()
    queryClient.setQueryData(datasetQuery.queryKey, { pages: [page(1, true)], pageParams: [1] })
    render(<SelectDataSet open onOpenChange={vi.fn()} onSelect={vi.fn()} selectedIds={[]} />, {
      wrapper,
    })
    const viewport = screen.getByRole('button', { name: /Dataset One/ }).parentElement!
    // happy-dom has no layout; keep the scroll viewport away from its bottom until the scroll event.
    Object.defineProperties(viewport, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 200 },
    })
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/datasets?page=1'))
    expect(mockGet.mock.calls.map(([url]) => url)).toEqual(['/datasets?page=1'])
    await act(async () => resolveRefresh(page(1, true)))
    expect(mockGet.mock.calls.map(([url]) => url)).toEqual(['/datasets?page=1'])
    fireEvent.scroll(viewport, { target: { scrollTop: 800 } })
    await waitFor(() =>
      expect(mockGet.mock.calls.map(([url]) => url)).toEqual([
        '/datasets?page=1',
        '/datasets?page=2',
      ]),
    )
    expect(screen.getByText('Dataset One')).toBeInTheDocument()
  })
})
