import { renderHook } from '@testing-library/react'
import { useTrialCredits } from '../use-trial-credits'

const mockUseCurrentWorkspace = vi.fn()

vi.mock('@/service/use-common', () => ({
  useCurrentWorkspace: () => mockUseCurrentWorkspace(),
}))

describe('useTrialCredits', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseCurrentWorkspace.mockReturnValue({
      data: {
        trial_credits: 100,
        trial_credits_used: 40,
        next_credit_reset_date: '2026-04-01',
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
        nextCreditResetDate: '2026-04-01',
      })
    })

    it('should keep the hook out of loading state during a background refetch', () => {
      mockUseCurrentWorkspace.mockReturnValue({
        data: {
          trial_credits: 80,
          trial_credits_used: 20,
          next_credit_reset_date: '2026-05-01',
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
      mockUseCurrentWorkspace.mockReturnValue({
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
      mockUseCurrentWorkspace.mockReturnValue({
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
