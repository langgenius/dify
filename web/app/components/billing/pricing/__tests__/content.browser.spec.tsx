import type { consoleClient } from '@/service/console'
import { Dialog } from '@langgenius/dify-ui/dialog'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { PricingContent } from '../content'

const api = vi.hoisted(() => ({
  features: vi.fn<typeof consoleClient.features.get>(),
  education: vi.fn<typeof consoleClient.account.education.get>(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'features.get': api.features,
      'account.education.get': api.education,
    }),
  }
})

async function setup(options: Parameters<typeof createConsoleQueryWrapper>[0] = {}) {
  const { queryClient, wrapper: Providers } = createConsoleQueryWrapper({
    currentWorkspace: { role: 'owner' },
    ...options,
  })
  onTestFinished(() => queryClient.clear())
  return render(
    <Providers>
      <Dialog>
        <PricingContent />
      </Dialog>
    </Providers>,
  )
}

beforeEach(() => {
  api.features.mockReset()
  api.education.mockReset()
})

it('keeps prices and interval selection available while purchases wait for features', async () => {
  const request = createDeferred<Awaited<ReturnType<typeof consoleClient.features.get>>>()
  api.features.mockReturnValue(request.promise)
  const screen = await setup()
  await expect.element(screen.getByRole('status')).toHaveTextContent('appApi.loading')
  await expect
    .element(screen.getByRole('link', { name: 'billing.plansCommon.comparePlanAndFeatures' }))
    .toBeVisible()
  const purchase = screen.getByRole('button', { name: 'billing.plansCommon.upgradeToProfessional' })
  await expect.element(purchase).toBeDisabled()
  await expect.element(screen.getByText('$59', { exact: true })).toBeInTheDocument()
  await screen.getByRole('radio', { name: /billing\.pricing\.annually/ }).click()
  await expect.element(screen.getByText('$590', { exact: true })).toBeInTheDocument()
  await expect.element(purchase).toBeDisabled()
  const { zGetFeaturesResponse } = await import('@dify/contracts/api/console/features/zod.gen')
  request.resolve(zGetFeaturesResponse.parse({ billing: { subscription: { plan: 'team' } } }))
  await expect
    .element(screen.getByRole('button', { name: 'billing.plansCommon.manageSubscription' }))
    .toBeEnabled()
  await expect.element(screen.getByRole('status')).not.toBeInTheDocument()
})

it('shows the payable annual or monthly price for the selected named interval', async () => {
  const screen = await setup({ features: {} })
  const intervals = screen.getByRole('radiogroup', { name: 'billing.pricing.billingInterval' })
  await intervals.getByRole('radio', { name: /billing\.pricing\.annually/ }).click()
  await expect.element(screen.getByText('$590', { exact: true })).toBeInTheDocument()
  await expect.element(screen.getByText('$1590', { exact: true })).toBeInTheDocument()
  await expect.element(screen.getByText('$708', { exact: true })).not.toBeInTheDocument()
  await expect.element(screen.getByText('$1908', { exact: true })).not.toBeInTheDocument()
  await intervals.getByRole('radio', { name: 'billing.pricing.monthly' }).click()
  await expect.element(screen.getByText('$59', { exact: true })).toBeInTheDocument()
  await expect.element(screen.getByText('$159', { exact: true })).toBeInTheDocument()
  await expect.element(screen.getByText('$590', { exact: true })).not.toBeInTheDocument()
  await expect.element(screen.getByText('$1590', { exact: true })).not.toBeInTheDocument()
})

it('preserves the chosen monthly interval when education eligibility arrives and refreshes', async () => {
  const request = createDeferred<Awaited<ReturnType<typeof consoleClient.account.education.get>>>()
  api.education.mockReturnValueOnce(request.promise).mockResolvedValue({
    is_student: true,
    allow_refresh: true,
    can_redeem_discount: true,
    expire_at: null,
    result: true,
  })
  const { queryClient, wrapper: Providers } = createConsoleQueryWrapper({
    currentWorkspace: { role: 'owner' },
    features: { education: { enabled: true } },
  })
  onTestFinished(() => queryClient.clear())
  const screen = await render(
    <Providers>
      <Dialog>
        <PricingContent />
      </Dialog>
    </Providers>,
  )
  const annual = screen.getByRole('radio', { name: /billing\.pricing\.annually/ })
  const purchase = screen.getByRole('button', { name: 'billing.plansCommon.upgradeToProfessional' })
  await expect.element(purchase).toBeDisabled()
  await annual.click()
  await screen.getByRole('radio', { name: 'billing.pricing.monthly' }).click()
  request.resolve({
    is_student: true,
    allow_refresh: false,
    can_redeem_discount: true,
    expire_at: null,
    result: true,
  })
  await expect.element(purchase).toBeEnabled()
  await expect.element(annual).not.toBeChecked()
  await expect.element(screen.getByText('$59', { exact: true })).toBeInTheDocument()
  const { consoleQuery } = await import('@/service/console')
  await queryClient.invalidateQueries({ queryKey: consoleQuery.account.education.get.key() })
  await expect.element(annual).not.toBeChecked()
})

it('starts cached eligible education accounts on annual pricing with the discount available', async () => {
  const screen = await setup({
    features: { education: { enabled: true } },
    educationStatus: { is_student: true, can_redeem_discount: true },
  })
  await expect
    .element(screen.getByRole('radio', { name: /billing\.pricing\.annually/ }))
    .toBeChecked()
  await expect.element(screen.getByText('$590', { exact: true })).toBeInTheDocument()
  await expect
    .element(screen.getByRole('button', { name: 'education.useEducationDiscount' }))
    .toBeEnabled()
  await expect.element(screen.getByRole('status')).not.toBeInTheDocument()
})

it('keeps prices readable after features fail and restores purchases through Retry', async () => {
  const { zGetFeaturesResponse } = await import('@dify/contracts/api/console/features/zod.gen')
  api.features
    .mockRejectedValueOnce(new Error('Unavailable'))
    .mockResolvedValue(zGetFeaturesResponse.parse({}))
  const screen = await setup()
  await expect.element(screen.getByRole('alert')).toMatchTextContent('common.error')
  const purchase = screen.getByRole('button', { name: 'billing.plansCommon.upgradeToProfessional' })
  await expect.element(purchase).toBeDisabled()
  await expect.element(screen.getByText('$59', { exact: true })).toBeInTheDocument()
  await screen.getByRole('button', { name: 'common.operation.retry' }).click()
  await expect.element(purchase).toBeEnabled()
  await expect.element(screen.getByRole('alert')).not.toBeInTheDocument()
})
