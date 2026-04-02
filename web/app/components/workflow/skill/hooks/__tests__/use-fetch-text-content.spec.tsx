import {
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { useFetchTextContent } from '../use-fetch-text-content'

const fetchMock = vi.fn<typeof fetch>()

describe('use-fetch-text-content', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
  })

  const createWrapper = () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    })

    return ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    )
  }

  it('should fetch and cache text content when a download url is provided', async () => {
    fetchMock.mockResolvedValue({
      text: vi.fn().mockResolvedValue('hello world'),
    } as unknown as Response)

    const { result } = renderHook(() => useFetchTextContent('https://example.com/file.txt'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.data).toBe('hello world'))

    expect(fetchMock).toHaveBeenCalledWith('https://example.com/file.txt')
    expect(result.current.isLoading).toBe(false)
  })

  it('should stay idle when the download url is missing', () => {
    const { result } = renderHook(() => useFetchTextContent(undefined), {
      wrapper: createWrapper(),
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.fetchStatus).toBe('idle')
    expect(result.current.data).toBeUndefined()
  })
})
