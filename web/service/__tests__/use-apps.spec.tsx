import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useConvertWorkflowTypeMutation } from '../use-apps'

const {
  invalidateQueries,
  convertWorkflowTypeMutationFn,
  convertWorkflowTypeMutationOptions,
} = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  convertWorkflowTypeMutationFn: vi.fn(),
  convertWorkflowTypeMutationOptions: vi.fn(),
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()

  return {
    ...actual,
    useQueryClient: () => ({
      invalidateQueries,
    }),
  }
})

vi.mock('@/service/client', () => ({
  consoleClient: {},
  consoleQuery: {
    apps: {
      convertWorkflowType: {
        mutationOptions: convertWorkflowTypeMutationOptions,
      },
    },
  },
}))

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

// Scenario: workflow type conversion forwards the expected API input and refreshes app caches.
describe('useConvertWorkflowTypeMutation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    convertWorkflowTypeMutationFn.mockResolvedValue({})
    convertWorkflowTypeMutationOptions.mockImplementation(options => ({
      mutationFn: convertWorkflowTypeMutationFn,
      onSuccess: options?.onSuccess,
    }))
  })

  it('should convert workflow type and invalidate app queries when mutation succeeds', async () => {
    // Arrange
    const { result } = renderHook(() => useConvertWorkflowTypeMutation(), {
      wrapper: createWrapper(),
    })

    // Act
    await act(async () => {
      result.current.mutate({
        params: { appId: 'app-1' },
        query: { target_type: 'evaluation' },
      })
    })

    // Assert
    await waitFor(() => {
      expect(convertWorkflowTypeMutationFn).toHaveBeenCalledWith(
        {
          params: { appId: 'app-1' },
          query: { target_type: 'evaluation' },
        },
        expect.any(Object),
      )
    })
    await waitFor(() => {
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['apps', 'detail', 'app-1'],
      })
    })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['apps', 'list'],
    })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['apps', 'full-list'],
    })
  })
})
