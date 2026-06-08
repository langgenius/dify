import { renderHook } from '@testing-library/react'
import { useTrialCredits } from '../use-trial-credits'

const { mockUseQuery } = vi.hoisted(() => ({
  mockUseQuery: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => mockUseQuery(),
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    workspaces: {
      current: {
        post: {
          queryOptions: () => ({ queryKey: ['console', 'workspaces', 'current', 'post'] }),
        },
      },
    },
  },
}))

describe('useTrialCredits', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseQuery.mockReturnValue({
      data: {
        trial_credits: 100,
        trial_credits_used: 40,
        next_credit_reset_date: 1775001600,
      },
      isPending: false,
    })
  })

  describe('when workspace data is available', () => {
    it('should return the remaining credits and reset date', () => {
      const { result } = renderHook(() => useTrialCredits())

      expect(result.current).toEqual({
        credits: 60,
        totalCredits: 100,
        isExhausted: false,
        isLoading: false,
        nextCreditResetDate: 1775001600,
      })
    })

    it('should keep the hook out of loading state during a background refetch', () => {
      mockUseQuery.mockReturnValue({
        data: {
          trial_credits: 80,
          trial_credits_used: 20,
          next_credit_reset_date: 1777593600,
        },
        isPending: true,
      })

      const { result } = renderHook(() => useTrialCredits())

      expect(result.current.isLoading).toBe(false)
      expect(result.current.credits).toBe(60)
      expect(result.current.isExhausted).toBe(false)
    })
  })

  describe('when workspace data is missing or exhausted', () => {
    it('should report loading while the first workspace request is pending', () => {
      mockUseQuery.mockReturnValue({
        data: undefined,
        isPending: true,
      })

      const { result } = renderHook(() => useTrialCredits())

      expect(result.current).toEqual({
        credits: 0,
        totalCredits: 0,
        isExhausted: true,
        isLoading: true,
        nextCreditResetDate: undefined,
      })
    })

    it('should clamp negative remaining credits to zero', () => {
      mockUseQuery.mockReturnValue({
        data: {
          trial_credits: 10,
          trial_credits_used: 99,
          next_credit_reset_date: undefined,
        },
        isPending: false,
      })

      const { result } = renderHook(() => useTrialCredits())

      expect(result.current.credits).toBe(0)
      expect(result.current.isExhausted).toBe(true)
    })
  })
})
