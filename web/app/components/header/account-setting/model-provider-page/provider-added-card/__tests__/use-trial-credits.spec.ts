import type { ModelProviderCreditsResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { zModelProviderCreditsResponse } from '@dify/contracts/api/console/workspaces/zod.gen'
import { act, waitFor } from '@testing-library/react'
import { consoleQuery } from '@/service/console'
import {
  createModelCreditsFixture,
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
): ModelProviderCreditsResponse =>
  createModelCreditsFixture({
    quota_used: 40,
    remaining_credits: 60,
    next_credit_reset_date: 1775001600,
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

  it('defaults rolling old payloads without billing fields to legacy credits', () => {
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
      modelBillingMigrationStatus: 'none',
      tokenerMetering: null,
      credits: 60,
      totalCredits: 100,
      usedCredits: 40,
      isExhausted: false,
    })
  })

  it('preserves Tokener decimal strings and entitlement errors without converting them to credits', () => {
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
  })

  it('keeps cached Tokener balance after a failed refetch and updates on a later successful refresh', async () => {
    getCredits.mockRejectedValueOnce(new Error('Metering unavailable'))
    const { result, queryClient } = renderCredits(createTokenerCreditsFixture())
    const queryKey = consoleQuery.workspaces.current.modelProviders.credits.get.queryKey()
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey })
    })
    expect(getCredits).toHaveBeenCalledOnce()
    expect(result.current.tokenerMetering?.available_usd_micro).toBe('12500000')
    expect(result.current.isLoading).toBe(false)
    getCredits.mockResolvedValueOnce(
      createTokenerCreditsFixture({
        tokener_metering: createTokenerMeteringFixture({ available_usd_micro: '11500000' }),
      }),
    )
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey })
    })
    await waitFor(() =>
      expect(result.current.tokenerMetering?.available_usd_micro).toBe('11500000'),
    )
    expect(result.current.modelBillingSource).toBe('tokener')
    expect(result.current.isExhausted).toBe(false)
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

  it('does not interpret a Tokener balance as exhausted legacy credits', () => {
    const metering = {
      tenant_id: 'tenant-1',
      currency: 'USD' as const,
      available_usd_micro: '-1500000',
      current_month: {
        status: 'unavailable' as const,
        start_date: '2026-09-01',
        end_date: '2026-09-03',
        error_code: 'metering_unavailable',
      },
      balance_generated_at: '2026-09-03T06:00:00Z',
    }
    const { result } = renderCredits(
      createCredits({
        model_billing_source: 'tokener',
        tokener_bootstrap_status: 'ready',
        tokener_metering: metering,
        quota_limit: 200,
        quota_used: 200,
        remaining_credits: 0,
        is_exhausted: true,
      }),
    )
    expect(result.current).toMatchObject({
      modelBillingSource: 'tokener',
      tokenerBootstrapStatus: 'ready',
      tokenerMetering: metering,
      credits: 0,
      usedCredits: 0,
      totalCredits: 0,
      isUnlimited: false,
      isExhausted: false,
    })
  })

  it.each([
    ['legacy_message_credits', 'none', 30_001, 0],
    ['tokener', 'none', 30_001, 1],
    ['legacy_message_credits', 'processing', 5_001, 1],
  ] as const)(
    'polls the visual %s/%s state at its server-owned cadence',
    async (source, status, elapsed, count) => {
      vi.useFakeTimers()
      const data = createCredits({
        model_billing_source: source,
        model_billing_migration_status: status,
      })
      getCredits.mockResolvedValue(data)
      const { unmount } = renderCredits(data, { pollTokenerMetering: true })
      try {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(elapsed)
        })
        expect(getCredits).toHaveBeenCalledTimes(count)
      } finally {
        unmount()
        vi.useRealTimers()
      }
    },
  )

  it('switches from processing polling to active Tokener metering polling after a real query response', async () => {
    vi.useFakeTimers()
    const { result, unmount } = renderCredits(
      createCredits({ model_billing_migration_status: 'processing' }),
      { pollTokenerMetering: true },
    )
    getCredits.mockResolvedValue(createTokenerCreditsFixture())
    try {
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
    } finally {
      unmount()
      vi.useRealTimers()
    }
  })

  it('does not poll from non-visual credit consumers', async () => {
    vi.useFakeTimers()
    const data = createCredits({ model_billing_source: 'tokener' })
    getCredits.mockResolvedValue(data)
    const { unmount } = renderCredits(data)
    try {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_001)
      })
      expect(getCredits).not.toHaveBeenCalled()
    } finally {
      unmount()
      vi.useRealTimers()
    }
  })
})
