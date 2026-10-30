import type { ModelProviderCreditsResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { zModelProviderCreditsResponse } from '@dify/contracts/api/console/workspaces/zod.gen'
import { act, waitFor } from '@testing-library/react'
import { consoleQuery } from '@/service/console'
import {
  createTokenerCreditsFixture,
  createTokenerMeteringFixture,
} from '@/test/console/model-billing'
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
  model_billing_source: 'legacy_message_credits',
  model_billing_migration_status: 'none',
  tokener_bootstrap_status: null,
  tokener_metering: null,
  ...overrides,
})
const renderCredits = (
  data?: ModelProviderCreditsResponse,
  options: Parameters<typeof useTrialCredits>[0] = {},
) => {
  const queryClient = createConsoleQueryClient()
  if (data)
    queryClient.setQueryData(
      consoleQuery.workspaces.current.modelProviders.credits.get.queryKey(),
      zModelProviderCreditsResponse.parse(data),
    )
  return renderHookWithConsoleQuery(() => useTrialCredits(options), { queryClient })
}

describe('useTrialCredits', () => {
  it('does not present migrated Tokener money as legacy credits', () => {
    const { result } = renderCredits(
      createCredits({
        model_billing_source: 'tokener',
        model_billing_migration_status: 'active',
        tokener_bootstrap_status: 'ready',
        quota_limit: null,
        quota_used: null,
        remaining_credits: null,
      }),
    )
    expect(result.current).toMatchObject({
      modelBillingSource: 'tokener',
      modelBillingMigrationStatus: 'active',
      tokenerBootstrapStatus: 'ready',
      credits: 0,
      usedCredits: 0,
      totalCredits: 0,
      isExhausted: false,
    })
  })

  beforeEach(() => {
    getCredits.mockReset().mockImplementation(() => new Promise(() => {}))
  })

  it('returns the remaining credits and reset date', () => {
    const { result } = renderCredits(createCredits())
    expect(result.current).toEqual({
      modelBillingSource: 'legacy_message_credits',
      modelBillingMigrationStatus: 'none',
      tokenerBootstrapStatus: null,
      tokenerMetering: null,
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

  it('defaults rolling old payloads without a billing source to legacy credits', () => {
    const { result } = renderCredits(
      createCredits({
        model_billing_source: undefined,
        model_billing_migration_status: undefined,
        tokener_bootstrap_status: undefined,
        tokener_metering: undefined,
      }),
    )
    expect(result.current).toMatchObject({
      modelBillingSource: 'legacy_message_credits',
      tokenerMetering: null,
      credits: 60,
      totalCredits: 100,
      usedCredits: 40,
      isExhausted: false,
    })
  })

  it('preserves Tokener money strings and entitlement errors without converting them to credits', () => {
    const metering = createTokenerMeteringFixture({
      available_usd_micro: '-12',
      entitlement_status: 'failed',
      entitlement_error_code: 'allowance_failed',
    })
    const { result } = renderCredits(createTokenerCreditsFixture({ tokener_metering: metering }))
    expect(result.current).toMatchObject({
      modelBillingSource: 'tokener',
      tokenerMetering: metering,
      credits: 0,
      usedCredits: 0,
      totalCredits: 0,
      isUnlimited: false,
      isExhausted: false,
    })
    expect(result.current.tokenerMetering?.available_usd_micro).toBe('-12')
  })

  it('polls migration processing quickly, then switches to the Tokener metering interval', async () => {
    vi.useFakeTimers()
    try {
      getCredits.mockResolvedValue(createTokenerCreditsFixture())
      const { result, unmount } = renderCredits(
        createCredits({
          model_billing_migration_status: 'processing',
        }),
        { pollTokenerMetering: true },
      )
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4_999)
      })
      expect(getCredits).not.toHaveBeenCalled()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1)
      })
      expect(getCredits).toHaveBeenCalledOnce()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(29_999)
      })
      expect(getCredits).toHaveBeenCalledOnce()
      expect(result.current.modelBillingMigrationStatus).toBe('active')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1)
      })
      expect(getCredits).toHaveBeenCalledTimes(2)
      unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([
    ['legacy polling', false, true],
    ['Tokener without polling', true, false],
  ] as const)('does not start a metering poll for %s', async (_label, tokener, poll) => {
    vi.useFakeTimers()
    try {
      const data = tokener ? createTokenerCreditsFixture() : createCredits()
      const { unmount } = renderCredits(data, { pollTokenerMetering: poll })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000)
      })
      expect(getCredits).not.toHaveBeenCalled()
      unmount()
    } finally {
      vi.useRealTimers()
    }
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
      modelBillingSource: 'legacy_message_credits',
      modelBillingMigrationStatus: undefined,
      tokenerBootstrapStatus: undefined,
      tokenerMetering: null,
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
