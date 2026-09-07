import type { ReactNode } from 'react'
import {
  dehydrate,
  HydrationBoundary,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { serverConsoleQuery } from '@/service/server'
import { createSystemFeaturesFixture } from '@/test/console/system-features'
import { SystemFeaturesBootstrapBoundary } from '../bootstrap-boundary'

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })

  return { promise, resolve }
}

const mocks = vi.hoisted(() => ({
  isClient: true,
  query: vi.fn(),
}))

vi.mock('server-only', () => ({}))

vi.mock('@/config/server', () => ({
  SERVER_CONSOLE_API_PREFIX: 'http://localhost/console/api',
}))

vi.mock('../client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../client')>()

  return {
    ...actual,
    systemFeaturesQueryOptions: () => ({
      ...actual.systemFeaturesQueryOptions(),
      queryFn: mocks.query,
      retryDelay: 0,
    }),
  }
})

vi.mock('@/app/components/full-screen-loading', () => ({
  FullScreenLoading: () => <div role="status">Loading system features</div>,
}))

vi.mock('@/utils/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/client')>()

  return {
    ...actual,
    get isClient() {
      return mocks.isClient
    },
  }
})

function createQueryClient() {
  return new QueryClient()
}

function renderBoundary(children: ReactNode, queryClient = createQueryClient()) {
  render(
    <QueryClientProvider client={queryClient}>
      <SystemFeaturesBootstrapBoundary>{children}</SystemFeaturesBootstrapBoundary>
    </QueryClientProvider>,
  )

  return queryClient
}

describe('SystemFeaturesBootstrapBoundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isClient = true
  })

  it('hydrates the server System Features query into the client boundary', () => {
    const serverQueryClient = createQueryClient()
    serverQueryClient.setQueryData(
      serverConsoleQuery.systemFeatures.get.queryKey(),
      createSystemFeaturesFixture(),
    )
    const queryClient = createQueryClient()

    render(
      <QueryClientProvider client={queryClient}>
        <HydrationBoundary state={dehydrate(serverQueryClient)}>
          <SystemFeaturesBootstrapBoundary>
            <div>Application</div>
          </SystemFeaturesBootstrapBoundary>
        </HydrationBoundary>
      </QueryClientProvider>,
    )

    expect(screen.getByText('Application')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(mocks.query).not.toHaveBeenCalled()
  })

  it('shows loading only while the client recovers missing server data', async () => {
    const deferred = createDeferred<ReturnType<typeof createSystemFeaturesFixture>>()
    mocks.query.mockReturnValue(deferred.promise)

    renderBoundary(<div>Application</div>)

    expect(screen.getByRole('status')).toHaveTextContent('Loading system features')
    expect(screen.queryByText('Application')).not.toBeInTheDocument()

    await act(async () => {
      deferred.resolve(createSystemFeaturesFixture())
    })

    expect(await screen.findByText('Application')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('does not duplicate the request during server rendering when prefetched data is missing', () => {
    mocks.isClient = false

    renderBoundary(<div>Application</div>)

    expect(screen.getByRole('status')).toHaveTextContent('Loading system features')
    expect(mocks.query).not.toHaveBeenCalled()
  })

  it('allows a manual retry after a client query error', async () => {
    const user = userEvent.setup()
    mocks.query.mockRejectedValue(new Error('system features unavailable'))

    renderBoundary(<div>Application</div>)

    const retryButton = await screen.findByRole('button', {
      name: 'common.errorBoundary.tryAgain',
    })

    mocks.query.mockResolvedValue(createSystemFeaturesFixture())
    await user.click(retryButton)

    expect(await screen.findByText('Application')).toBeInTheDocument()
  })
})
