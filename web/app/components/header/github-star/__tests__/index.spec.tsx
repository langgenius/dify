import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import GithubStar from '../index'

const GITHUB_STAR_URL = 'https://ungh.cc/repos/langgenius/dify'

const renderWithQueryClient = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <GithubStar className="test-class" />
    </QueryClientProvider>,
  )
}

const createJsonResponse = (body: Record<string, unknown>, status = 200) => {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const createDeferred = <T,>() => {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, resolve, reject }
}

describe('GithubStar', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  // Covers the fetched star count shown after a successful request.
  it('should render fetched star count', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      createJsonResponse({ repo: { stars: 123456 } }),
    )

    renderWithQueryClient()

    expect(await screen.findByText('123,456')).toBeInTheDocument()
    expect(fetchSpy).toHaveBeenCalledWith(GITHUB_STAR_URL)
  })

  // Covers the fallback star count shown when the request fails.
  it('should render default star count on error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      createJsonResponse({}, 500),
    )

    renderWithQueryClient()

    expect(await screen.findByText('110,918')).toBeInTheDocument()
  })

  // Covers the loading indicator while the fetch promise is still pending.
  it('should show loader while fetching', async () => {
    const deferred = createDeferred<Response>()
    vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(deferred.promise)

    const { container } = renderWithQueryClient()

    expect(container.querySelector('.animate-spin')).toBeInTheDocument()

    deferred.resolve(createJsonResponse({ repo: { stars: 222222 } }))

    await waitFor(() => {
      expect(screen.getByText('222,222')).toBeInTheDocument()
    })
  })
})
