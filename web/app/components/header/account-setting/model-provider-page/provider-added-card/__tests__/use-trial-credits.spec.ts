import type { ModelProviderCreditsResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { act, waitFor } from '@testing-library/react'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderHookWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { useTrialCredits } from '../use-trial-credits'

const getCredits = vi.hoisted(() => vi.fn())
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.modelProviders.credits.get': getCredits,
    }),
  }
})

const createCredits = (
  overrides: Partial<ModelProviderCreditsResponse> = {},
): ModelProviderCreditsResponse => ({
  quota_limit: 100,
  quota_used: 40,
  remaining_credits: 60,
  is_unlimited: false,
  is_exhausted: false,
  exhausted_at: null,
  next_credit_reset_date: 1775001600,
  pool_type: 'trial',
  ...overrides,
})
const renderCredits = (data?: ModelProviderCreditsResponse) => {
  const queryClient = createConsoleQueryClient()
  if (data)
    queryClient.setQueryData(
      consoleQuery.workspaces.current.modelProviders.credits.get.queryKey(),
      data,
    )
  return renderHookWithConsoleQuery(() => useTrialCredits(), { queryClient })
}

describe('useTrialCredits', () => {
  beforeEach(() => {
    getCredits.mockReset().mockImplementation(() => new Promise(() => {}))
  })

  it('returns the remaining credits and reset date', () => {
    const { result } = renderCredits(createCredits())
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

  it('keeps cached credits visible while a background refetch is pending and updates after it settles', async () => {
    const request = createDeferred<ModelProviderCreditsResponse>()
    getCredits.mockReturnValue(request.promise)
    const { result, queryClient } = renderCredits(createCredits())
    act(() => {
      void queryClient.invalidateQueries({
        queryKey: consoleQuery.workspaces.current.modelProviders.credits.get.queryKey(),
      })
    })
    await waitFor(() => expect(getCredits).toHaveBeenCalledOnce())
    expect(result.current.isLoading).toBe(false)
    expect(result.current.credits).toBe(60)
    await act(async () => request.resolve(createCredits({ quota_used: 50, remaining_credits: 50 })))
    await waitFor(() => expect(result.current.credits).toBe(50))
    expect(result.current.usedCredits).toBe(50)
    expect(result.current.isLoading).toBe(false)
  })

  it('reports loading before the first response and settles with server credits', async () => {
    const request = createDeferred<ModelProviderCreditsResponse>()
    getCredits.mockReturnValue(request.promise)
    const { result } = renderCredits()
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
    await act(async () => request.resolve(createCredits()))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.credits).toBe(60)
  })

  it('uses the backend exhausted state', () => {
    const { result } = renderCredits(
      createCredits({
        quota_limit: 10,
        quota_used: 10,
        remaining_credits: 0,
        is_exhausted: true,
        exhausted_at: 1772323200,
      }),
    )
    expect(result.current).toMatchObject({
      credits: 0,
      usedCredits: 10,
      isExhausted: true,
      exhaustedAt: 1772323200,
    })
  })

  it('preserves unlimited credits without interpreting sentinel values as usage', () => {
    const { result } = renderCredits(
      createCredits({
        quota_limit: -1,
        quota_used: 999,
        remaining_credits: -1,
        is_unlimited: true,
        is_exhausted: false,
        next_credit_reset_date: null,
      }),
    )
    expect(result.current).toMatchObject({
      credits: -1,
      usedCredits: 999,
      totalCredits: -1,
      isUnlimited: true,
      isExhausted: false,
    })
  })
})
