import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { useEducationVerify } from '../use-education'

const mockVerifyEducation = vi.hoisted(() => vi.fn())

vi.mock('../client', () => ({
  consoleClient: {
    account: {
      education: {
        verify: {
          get: mockVerifyEducation,
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

describe('useEducationVerify', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('requests a verification token silently through the generated client', async () => {
    mockVerifyEducation.mockResolvedValue({ token: 'education-token' })
    const { result } = renderHook(() => useEducationVerify(), { wrapper: createWrapper() })

    await act(async () => {
      await expect(result.current.mutateAsync()).resolves.toEqual({ token: 'education-token' })
    })

    expect(mockVerifyEducation).toHaveBeenCalledWith({}, { context: { silent: true } })
  })

  it('rejects an invalid successful response without a token', async () => {
    mockVerifyEducation.mockResolvedValue({ token: null })
    const { result } = renderHook(() => useEducationVerify(), { wrapper: createWrapper() })

    await act(async () => {
      await expect(result.current.mutateAsync()).rejects.toThrow(
        'Education verification token is missing',
      )
    })
  })
})
