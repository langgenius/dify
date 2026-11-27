import {
  infiniteQueryOptions,
  QueryClient,
  QueryClientProvider,
  queryOptions,
  useInfiniteQuery,
  useQuery,
} from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from '@/app/notifications'
import { createErrorToastCaches } from '@/app/query-error-toast'
import { createHttpError } from '@/service/http-error'
import { createDeferred } from '@/test/deferred'
import {
  useOwnedNextPageError,
  useOwnedQueryError,
  useOwnedQueryErrors,
} from '../use-owned-query-error'

vi.mock('@/app/notifications', () => ({ toast: { error: vi.fn() } }))

const unavailable = () =>
  createHttpError(
    { status: 503, statusText: '', headers: new Headers() },
    { message: 'Unavailable' },
  )

const createClient = () =>
  new QueryClient({
    ...createErrorToastCaches(),
    defaultOptions: { queries: { retry: false } },
  })

// The cache dedupes a message per query for a while, so each test reads its own query.
let keyIndex = 0
const nextKey = () => ['owned', keyIndex++]

// A few macrotasks: past the cache's wait for the render that follows a failure.
const afterReportWindow = () => new Promise((resolve) => setTimeout(resolve, 20))

function Owner({ queryFn, queryKey }: { queryFn: () => Promise<string>; queryKey: unknown[] }) {
  const query = useQuery(queryOptions({ queryKey, queryFn }))
  const loadError = useOwnedQueryError(query)
  if (loadError)
    return (
      <button type="button" onClick={loadError.retry}>
        Retry
      </button>
    )
  return <p>{query.data ?? 'Loading'}</p>
}

function Reader({ queryFn, queryKey }: { queryFn: () => Promise<string>; queryKey: unknown[] }) {
  const query = useQuery(queryOptions({ queryKey, queryFn }))
  return <p>{query.data ?? 'Nothing'}</p>
}

describe('useOwnedQueryError', () => {
  beforeEach(() => {
    vi.mocked(toast.error).mockClear()
  })

  it('claims a failed first load it renders, so the cache does not toast it', async () => {
    const queryClient = createClient()
    render(
      <QueryClientProvider client={queryClient}>
        <Owner queryKey={nextKey()} queryFn={() => Promise.reject(unavailable())} />
      </QueryClientProvider>,
    )

    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument()
    await afterReportWindow()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('leaves an unclaimed failed first load to the cache, which toasts it after one render', async () => {
    const queryClient = createClient()
    render(
      <QueryClientProvider client={queryClient}>
        <Reader queryKey={nextKey()} queryFn={() => Promise.reject(unavailable())} />
      </QueryClientProvider>,
    )

    await waitFor(() => expect(toast.error).toHaveBeenCalledExactlyOnceWith('Unavailable'))
    expect(screen.getByText('Nothing')).toBeInTheDocument()
  })

  it('toasts a failed first load whose owner unmounted before rendering it', async () => {
    const queryClient = createClient()
    const response = createDeferred<string>()
    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <Owner queryKey={nextKey()} queryFn={() => response.promise} />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(queryClient.isFetching()).toBe(1))
    unmount()
    response.reject(unavailable())

    await waitFor(() => expect(toast.error).toHaveBeenCalledExactlyOnceWith('Unavailable'))
  })

  it('still toasts a failed refetch once over the data its owner keeps showing', async () => {
    const queryClient = createClient()
    const queryFn = vi.fn<() => Promise<string>>().mockResolvedValueOnce('Loaded')
    queryFn.mockRejectedValue(unavailable())
    const queryKey = nextKey()
    render(
      <QueryClientProvider client={queryClient}>
        <Owner queryKey={queryKey} queryFn={queryFn} />
      </QueryClientProvider>,
    )
    expect(await screen.findByText('Loaded')).toBeInTheDocument()

    await queryClient.refetchQueries({ queryKey })

    await waitFor(() => expect(toast.error).toHaveBeenCalledExactlyOnceWith('Unavailable'))
    expect(screen.getByText('Loaded')).toBeInTheDocument()
    await afterReportWindow()
    expect(toast.error).toHaveBeenCalledOnce()
  })

  it('claims every failed read of an owner of several and retries each of them', async () => {
    const user = userEvent.setup()
    const queryClient = createClient()
    const first = vi.fn<() => Promise<string>>().mockRejectedValueOnce(unavailable())
    first.mockResolvedValue('First')
    const second = vi.fn<() => Promise<string>>().mockRejectedValueOnce(unavailable())
    second.mockResolvedValue('Second')
    const firstKey = nextKey()
    const secondKey = nextKey()
    function Pair() {
      const a = useQuery(queryOptions({ queryKey: firstKey, queryFn: first }))
      const b = useQuery(queryOptions({ queryKey: secondKey, queryFn: second }))
      const loadError = useOwnedQueryErrors([a, b])
      if (loadError)
        return (
          <button type="button" onClick={loadError.retry}>
            Retry
          </button>
        )
      return <p>{`${a.data ?? ''} ${b.data ?? ''}`}</p>
    }
    render(
      <QueryClientProvider client={queryClient}>
        <Pair />
      </QueryClientProvider>,
    )

    await user.click(await screen.findByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('First Second')).toBeInTheDocument()
    await afterReportWindow()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('claims a failed next page its list renders, and retries that page', async () => {
    const user = userEvent.setup()
    const queryClient = createClient()
    const queryKey = nextKey()
    const queryFn = vi.fn<(context: { pageParam: number }) => Promise<string>>()
    queryFn.mockResolvedValueOnce('Page 1').mockRejectedValueOnce(unavailable())
    queryFn.mockResolvedValue('Page 2')
    function List() {
      const query = useInfiniteQuery(
        infiniteQueryOptions({
          queryKey,
          queryFn,
          initialPageParam: 1,
          getNextPageParam: (_page, pages) => (pages.length < 2 ? pages.length + 1 : undefined),
        }),
      )
      const nextPage = useOwnedNextPageError(query)
      return (
        <>
          <p>{query.data?.pages.join(' ')}</p>
          {nextPage ? (
            <button type="button" onClick={nextPage.retry}>
              Retry page
            </button>
          ) : (
            <button type="button" onClick={() => void query.fetchNextPage()}>
              More
            </button>
          )}
        </>
      )
    }
    render(
      <QueryClientProvider client={queryClient}>
        <List />
      </QueryClientProvider>,
    )
    await user.click(await screen.findByRole('button', { name: 'More' }))
    await user.click(await screen.findByRole('button', { name: 'Retry page' }))

    expect(await screen.findByText('Page 1 Page 2')).toBeInTheDocument()
    await afterReportWindow()
    expect(toast.error).not.toHaveBeenCalled()
  })
})
