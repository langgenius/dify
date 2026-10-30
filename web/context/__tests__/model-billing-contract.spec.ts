import {
  zCurrentWorkspaceSummaryResponse,
  zModelProviderCreditsResponse,
} from '@dify/contracts/api/console/workspaces/zod.gen'
import { describe, expect, it } from 'vitest'

describe('model billing rolling contracts', () => {
  it('defaults an old workspace summary payload to legacy billing', () => {
    const result = zCurrentWorkspaceSummaryResponse.parse({
      credits: 200,
      id: 'tenant-1',
      name: 'Legacy workspace',
      plan: 'sandbox',
      role: 'owner',
    })

    expect(result.model_billing_source).toBe('legacy_message_credits')
    expect(result.tokener_bootstrap_status ?? null).toBeNull()
  })

  it('defaults an old provider credits payload to legacy billing', () => {
    const result = zModelProviderCreditsResponse.parse({
      exhausted_at: null,
      is_exhausted: false,
      is_unlimited: false,
      next_credit_reset_date: null,
      pool_type: 'trial',
      quota_limit: 200,
      quota_used: 0,
      remaining_credits: 200,
    })

    expect(result.model_billing_source).toBe('legacy_message_credits')
    expect(result.tokener_bootstrap_status ?? null).toBeNull()
    expect(result.tokener_metering ?? null).toBeNull()
  })

  it('preserves decimal strings in available Tokener metering', () => {
    const result = zModelProviderCreditsResponse.parse({
      exhausted_at: null,
      is_exhausted: false,
      is_unlimited: false,
      model_billing_source: 'tokener',
      next_credit_reset_date: null,
      pool_type: null,
      quota_limit: null,
      quota_used: null,
      remaining_credits: null,
      tokener_bootstrap_status: 'ready',
      tokener_metering: {
        tenant_id: 'tenant-1',
        currency: 'USD',
        available_usd_micro: '-12',
        current_month: {
          status: 'available',
          start_date: '2026-09-01',
          end_date: '2026-09-03',
          billed_usd_micro: '999988',
          request_count: '9007199254740993',
        },
        balance_generated_at: '2026-09-03T06:00:00Z',
        usage_generated_at: '2026-09-03T05:59:30Z',
        entitlement_status: 'active',
        allowance: {
          window_id: 'invoice-period-1',
          source_ref: 'invoice-1',
          amount_usd_micro: '59000000',
          available_usd_micro: '20000000',
          starts_at: '2026-09-01T00:00:00Z',
          ends_at: '2026-10-01T00:00:00Z',
        },
      },
    })

    expect(result.tokener_metering?.available_usd_micro).toBe('-12')
    expect(result.tokener_metering?.current_month).toMatchObject({
      status: 'available',
      billed_usd_micro: '999988',
      request_count: '9007199254740993',
    })
    expect(result.tokener_metering?.entitlement_status).toBe('active')
    expect(result.tokener_metering?.allowance).toMatchObject({
      amount_usd_micro: '59000000',
      available_usd_micro: '20000000',
    })
  })

  it('accepts balance when the monthly Tokener rollup is unavailable', () => {
    const result = zModelProviderCreditsResponse.parse({
      exhausted_at: null,
      is_exhausted: false,
      is_unlimited: false,
      model_billing_source: 'tokener',
      next_credit_reset_date: null,
      pool_type: null,
      quota_limit: null,
      quota_used: null,
      remaining_credits: null,
      tokener_bootstrap_status: 'ready',
      tokener_metering: {
        tenant_id: 'tenant-1',
        currency: 'USD',
        available_usd_micro: '12500000',
        current_month: {
          status: 'unavailable',
          start_date: '2026-09-01',
          end_date: '2026-09-03',
          error_code: 'metering_unavailable',
        },
        balance_generated_at: '2026-09-03T06:00:00Z',
      },
    })

    expect(result.tokener_metering?.available_usd_micro).toBe('12500000')
    expect(result.tokener_metering?.current_month).toEqual({
      status: 'unavailable',
      start_date: '2026-09-01',
      end_date: '2026-09-03',
      error_code: 'metering_unavailable',
    })
    expect(result.tokener_metering?.allowance ?? null).toBeNull()
    expect(result.tokener_metering?.entitlement_status ?? null).toBeNull()
    expect(result.tokener_metering?.entitlement_error_code ?? null).toBeNull()
  })
})
