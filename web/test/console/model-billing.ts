import type {
  ModelProviderCreditsResponse,
  TokenerMeteringResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import { zModelProviderCreditsResponse } from '@dify/contracts/api/console/workspaces/zod.gen'

export const createModelCreditsFixture = (overrides: Partial<ModelProviderCreditsResponse> = {}) =>
  zModelProviderCreditsResponse.parse({
    quota_limit: 100,
    quota_used: 30,
    remaining_credits: 70,
    is_unlimited: false,
    is_exhausted: false,
    exhausted_at: null,
    next_credit_reset_date: 1735603200,
    pool_type: 'trial',
    model_billing_source: 'legacy_message_credits',
    model_billing_migration_status: 'none',
    tokener_bootstrap_status: null,
    tokener_metering: null,
    ...overrides,
  })

export const createTokenerMeteringFixture = (
  overrides: Partial<TokenerMeteringResponse> = {},
): TokenerMeteringResponse => ({
  tenant_id: 'tenant-1',
  currency: 'USD',
  available_usd_micro: '12500000',
  current_month: {
    status: 'available',
    start_date: '2026-09-01',
    end_date: '2026-09-03',
    billed_usd_micro: '3750000',
    request_count: '42',
  },
  balance_generated_at: '2026-09-03T06:00:00Z',
  usage_generated_at: '2026-09-03T05:59:30Z',
  ...overrides,
})

export const createTokenerCreditsFixture = (
  overrides: Partial<ModelProviderCreditsResponse> = {},
) =>
  createModelCreditsFixture({
    model_billing_source: 'tokener',
    model_billing_migration_status: 'active',
    tokener_bootstrap_status: 'ready',
    quota_limit: null,
    quota_used: null,
    remaining_credits: null,
    pool_type: null,
    next_credit_reset_date: null,
    tokener_metering: createTokenerMeteringFixture(),
    ...overrides,
  })
