import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { useEducationAutocomplete } from '../use-education'

const mockAutocompleteEducation = vi.hoisted(() => vi.fn())

vi.mock('../client', () => ({
  consoleClient: {
    account: {
      education: {
        autocomplete: {
          get: mockAutocompleteEducation,
        },
      },
    },
  },
}))

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  })

  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('useEducationAutocomplete', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('normalizes an empty generated response for the search UI', async () => {
    mockAutocompleteEducation.mockResolvedValue({})
    const { result } = renderHook(() => useEducationAutocomplete(), { wrapper: createWrapper() })

    await act(async () => {
      await expect(result.current.mutateAsync({ keywords: 'Dify' })).resolves.toEqual({
        curr_page: 0,
        data: [],
        has_next: false,
      })
    })

    expect(mockAutocompleteEducation).toHaveBeenCalledWith({
      query: { keywords: 'Dify', limit: 40, page: 0 },
    })
  })
})
