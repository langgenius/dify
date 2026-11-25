import type { ModelProviderCreditsResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { render } from 'vitest-browser-react'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { setupFakeApi } from '@/test/fake-api'
import QuotaPanel from '../quota-panel'

const legacy: ModelProviderCreditsResponse = {
  pool_type: 'trial',
  remaining_credits: 70,
  quota_limit: 100,
  quota_used: 30,
  is_exhausted: false,
  is_unlimited: false,
  exhausted_at: null,
  next_credit_reset_date: null,
}

const tokener: ModelProviderCreditsResponse = {
  ...legacy,
  pool_type: null,
  quota_limit: null,
  quota_used: null,
  remaining_credits: null,
  model_billing_source: 'tokener',
  tokener_bootstrap_status: 'pending',
}

const period = { start_date: '2026-11-01', end_date: '2026-11-18' }
const wallet = {
  tenant_id: '35cc64b8-426d-4aa6-982b-e842ada76217',
  currency: 'USD' as const,
  available_usd_micro: '1250000',
  balance_generated_at: '2026-11-18T04:00:00Z',
}

const fake = setupFakeApi({
  console: {
    trialModels: { get: () => ({ trial_models: [] }) },
    workspaces: { current: { modelProviders: { credits: { get: () => legacy } } } },
  },
})

async function renderQuota(response: ModelProviderCreditsResponse) {
  const getCredits = fake.console.workspaces.current.modelProviders.credits.get
  getCredits.mockReturnValue(response)
  const { queryClient, wrapper: Wrapper } = createConsoleQueryWrapper({
    systemFeatures: { deployment_edition: 'CLOUD' },
  })
  onTestFinished(() => queryClient.clear())
  const queryKey = consoleQuery.workspaces.current.modelProviders.credits.get.queryKey()
  const screen = await render(
    <Wrapper>
      <QuotaPanel providers={[]} />
    </Wrapper>,
  )
  return {
    screen,
    async update(response: ModelProviderCreditsResponse) {
      getCredits.mockReturnValue(response)
      await queryClient.invalidateQueries({ queryKey, exact: true })
    },
  }
}

it('shows pending signup setup, then a real balance, without claiming unavailable usage is zero', async () => {
  const { screen, update } = await renderQuota(tokener)
  await expect.element(screen.getByText(/tokenerUsagePending/)).toBeVisible()
  await expect.element(screen.getByText(/quotaLabel/)).not.toBeInTheDocument()

  await update({
    ...tokener,
    tokener_bootstrap_status: 'ready',
    tokener_metering: {
      ...wallet,
      current_month: { ...period, status: 'unavailable', error_code: 'usage_unavailable' },
    },
  })
  await expect.element(screen.getByText('$1.25')).toBeVisible()
  await expect.element(screen.getByText(/tokenerMonthlyUsageUnavailable/)).toBeVisible()
  await expect.element(screen.getByText('$0.00')).not.toBeInTheDocument()

  await update({
    ...tokener,
    tokener_bootstrap_status: 'ready',
    tokener_metering: {
      ...wallet,
      current_month: { ...period, status: 'available', billed_usd_micro: '0', request_count: '0' },
    },
  })
  await expect.element(screen.getByText('$0.00')).toBeVisible()
  await expect.element(screen.getByText(/tokenerMonthlyUsageUnavailable/)).not.toBeInTheDocument()
})

it('keeps the legacy credit panel for an existing workspace with no Tokener profile', async () => {
  const { screen } = await renderQuota(legacy)
  await expect.element(screen.getByText(/quotaLabel/)).toBeVisible()
  await expect.element(screen.getByText('30')).toBeVisible()
  await expect.element(screen.getByText('100')).toBeVisible()
  await expect.element(screen.getByText(/tokenerUsageLabel/)).not.toBeInTheDocument()
})
