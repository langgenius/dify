import { renderHook } from '@testing-library/react'
import { useTrialCredits } from '../use-trial-credits'

const { mockUseQuery } = vi.hoisted(() => ({
  mockUseQuery: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: unknown) => mockUseQuery(options),
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    workspaces: {
      current: {
        modelProviders: {
          credits: {
            get: {
              queryOptions: (options?: object) => ({
                queryKey: ['console', 'workspaces', 'current', 'model-providers', 'credits', 'get'],
                ...options,
              }),
            },
          },
        },
      },
    },
  },
}))

describe('useTrialCredits', () => {
  const mockTrialCreditsQuery = (
    data:
      | {
          quota_limit?: number | null
          quota_used?: number | null
          remaining_credits?: number | null
          is_unlimited?: boolean
          is_exhausted?: boolean
          exhausted_at?: number | null
          next_credit_reset_date?: number | null
        }
      | undefined,
    isPending = false,
  ) => {
    mockUseQuery.mockImplementation((options: { select?: (value: typeof data) => unknown }) => ({
      data: data && options.select ? options.select(data) : data,
      isPending,
    }))
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockTrialCreditsQuery({
      quota_limit: 100,
      quota_used: 40,
      remaining_credits: 60,
      is_exhausted: false,
      exhausted_at: undefined,
      next_credit_reset_date: 1775001600,
    })
  })

  describe('when workspace data is available', () => {
    it('should return the remaining credits and reset date', () => {
      const { result } = renderHook(() => useTrialCredits())

      expect(result.current).toEqual({
        credits: 60,
        usedCredits: 40,
        totalCredits: 100,
        isUnlimited: false,
        isExhausted: false,
        isLoading: false,
        exhaustedAt: undefined,
        nextCreditResetDate: 1775001600,
      })
    })

    it('should keep the hook out of loading state during a background refetch', () => {
      mockTrialCreditsQuery(
        {
          quota_limit: 80,
          quota_used: 20,
          remaining_credits: 60,
          is_exhausted: false,
          next_credit_reset_date: 1777593600,
        },
        true,
      )

      const { result } = renderHook(() => useTrialCredits())

      expect(result.current.isLoading).toBe(false)
      expect(result.current.credits).toBe(60)
      expect(result.current.usedCredits).toBe(20)
      expect(result.current.isUnlimited).toBe(false)
      expect(result.current.isExhausted).toBe(false)
    })
  })

  describe('when workspace data is missing or exhausted', () => {
    it('should report loading while the first workspace request is pending', () => {
      mockTrialCreditsQuery(undefined, true)

      const { result } = renderHook(() => useTrialCredits())

      expect(result.current).toEqual({
        credits: 0,
        usedCredits: 0,
        totalCredits: 0,
        isUnlimited: false,
        isExhausted: true,
        isLoading: true,
        exhaustedAt: undefined,
        nextCreditResetDate: undefined,
      })
    })

    it('should use the backend exhausted state', () => {
      mockTrialCreditsQuery({
        quota_limit: 10,
        quota_used: 10,
        remaining_credits: 0,
        is_exhausted: true,
        exhausted_at: 1772323200,
        next_credit_reset_date: undefined,
      })

      const { result } = renderHook(() => useTrialCredits())

      expect(result.current.credits).toBe(0)
      expect(result.current.usedCredits).toBe(10)
      expect(result.current.isExhausted).toBe(true)
      expect(result.current.exhaustedAt).toBe(1772323200)
    })

    it('should preserve the unlimited state without interpreting sentinel credits as usage', () => {
      mockTrialCreditsQuery({
        quota_limit: -1,
        quota_used: 999,
        remaining_credits: -1,
        is_unlimited: true,
        is_exhausted: false,
        exhausted_at: null,
        next_credit_reset_date: null,
      })

      const { result } = renderHook(() => useTrialCredits())

      expect(result.current).toMatchObject({
        credits: -1,
        usedCredits: 999,
        totalCredits: -1,
        isUnlimited: true,
        isExhausted: false,
      })
    })
  })
})
