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
    expect(result.tokener_bootstrap_status).toBeNull()
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
    expect(result.tokener_bootstrap_status).toBeNull()
  })
})
