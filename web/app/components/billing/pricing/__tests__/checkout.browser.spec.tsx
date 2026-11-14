import type { consoleClient } from '@/service/console'
import { Dialog } from '@langgenius/dify-ui/dialog'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { AppToaster } from '@/app/notifications/app-toaster'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { PricingContent } from '../content'

const api = vi.hoisted(() => ({
  subscription: vi.fn<typeof consoleClient.billing.subscription.get>(),
  invoices: vi.fn<typeof consoleClient.billing.invoices.get>(),
  education: vi.fn<typeof consoleClient.account.education.get>(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses, withConsoleResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'billing.subscription.get': api.subscription,
      'billing.invoices.get': api.invoices,
    }),
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'account.education.get': api.education,
    }),
  }
})

const initialUrl = window.location.href
beforeEach(() => {
  api.subscription.mockReset()
  api.invoices.mockReset()
  api.education.mockReset()
})
afterEach(() => window.history.replaceState(null, '', initialUrl))

async function setup(options: Parameters<typeof createConsoleQueryWrapper>[0]) {
  const { queryClient, wrapper: Providers } = createConsoleQueryWrapper({
    currentWorkspace: { role: 'owner' },
    ...options,
  })
  onTestFinished(() => queryClient.clear())
  await render(
    <Providers>
      <Dialog>
        <PricingContent />
        <AppToaster />
      </Dialog>
    </Providers>,
  )
}

// Same-document response URLs let Chromium perform the real location assignment without
// leaving the component runner. The billing service still supplies the destination.
const destination = (hash: string) => new URL(`#${hash}`, initialUrl).href

it.each([
  ['year', true],
  ['month', false],
] as const)(
  'takes paid subscribers directly to Team checkout for %s billing',
  async (interval, activated) => {
    const url = destination('team-checkout')
    api.subscription.mockResolvedValue({ url })
    await setup({
      features: {
        billing: { subscription: { plan: 'professional', interval: 'year' } },
        education: { enabled: true, activated },
      },
    })
    await expect.element(page.getByText('billing.plansCommon.currentPlan')).toBeVisible()
    if (interval === 'month')
      await page.getByRole('radio', { name: 'billing.pricing.monthly' }).click()
    await page.getByRole('button', { name: 'billing.plansCommon.upgradeToTeam' }).click()
    await expect.poll(() => window.location.href).toBe(url)
    expect(api.subscription).toHaveBeenCalledExactlyOnceWith(
      { query: { plan: 'team', interval } },
      { context: { silent: true } },
    )
    expect(api.education).not.toHaveBeenCalled()
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
  },
)

it('offers education pricing before Team checkout and serializes the selected purchase', async () => {
  const request =
    createDeferred<Awaited<ReturnType<typeof consoleClient.billing.subscription.get>>>()
  api.subscription.mockReturnValue(request.promise)
  await setup({
    features: { education: { enabled: true, activated: false } },
    educationStatus: { is_student: true, can_redeem_discount: true },
  })
  await page.getByRole('button', { name: 'billing.plansCommon.upgradeToTeam' }).click()
  const dialog = page.getByRole('dialog', { name: 'education.educationPricingConfirm.title' })
  await expect.element(dialog).toBeVisible()
  expect(api.subscription).not.toHaveBeenCalled()
  await dialog.getByRole('button', { name: 'education.educationPricingConfirm.cancel' }).click()
  await expect
    .element(dialog.getByRole('button', { name: 'education.educationPricingConfirm.continue' }))
    .toBeDisabled()
  expect(api.subscription).toHaveBeenCalledExactlyOnceWith(
    { query: { plan: 'team', interval: 'year' } },
    { context: { silent: true } },
  )
  const url = destination('team-education-notice')
  request.resolve({ url })
  await expect.poll(() => window.location.href).toBe(url)
  await expect.element(dialog).not.toBeInTheDocument()
})

it.each([
  ['professional', 'month', 'year'],
  ['professional', 'year', 'month'],
  ['team', 'month', 'year'],
  ['team', 'year', 'month'],
] as const)(
  'confirms the %s subscription change from %s to %s',
  async (plan, currentInterval, selectedInterval) => {
    const url = destination('confirmed-cycle')
    api.subscription.mockResolvedValue({ url })
    await setup({ features: { billing: { subscription: { plan, interval: currentInterval } } } })
    await page
      .getByRole('radio', {
        name:
          selectedInterval === 'year' ? /billing\.pricing\.annually/ : 'billing.pricing.monthly',
      })
      .click()
    await expect.element(page.getByText('billing.plansCommon.currentPlan')).not.toBeInTheDocument()
    const manage = page.getByRole('button', { name: 'billing.plansCommon.manageSubscription' })
    await manage.click()
    const dialog = page.getByRole('dialog')
    await expect.element(dialog).toBeVisible()
    expect(api.subscription).not.toHaveBeenCalled()
    await dialog.getByRole('button', { name: 'billing.pricing.cycleNotice.back' }).click()
    await expect.element(dialog).not.toBeInTheDocument()
    expect(api.subscription).not.toHaveBeenCalled()
    await manage.click()
    await dialog.getByRole('button', { name: 'billing.plansCommon.manageSubscription' }).click()
    await expect.poll(() => window.location.href).toBe(url)
    expect(api.subscription).toHaveBeenCalledExactlyOnceWith(
      { query: { plan, interval: selectedInterval } },
      { context: { silent: true } },
    )
    expect(api.invoices).not.toHaveBeenCalled()
  },
)

it.each(['month', 'year'] as const)(
  'opens the portal once for the current %s subscription',
  async (interval) => {
    const request = createDeferred<Awaited<ReturnType<typeof consoleClient.billing.invoices.get>>>()
    api.invoices.mockReturnValue(request.promise)
    await setup({ features: { billing: { subscription: { plan: 'professional', interval } } } })
    const manage = page.getByRole('button', { name: 'billing.plansCommon.manageSubscription' })
    await manage.click()
    await expect.element(manage).toHaveAttribute('aria-disabled', 'true')
    await expect.element(manage).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(api.invoices).toHaveBeenCalledTimes(1)
    expect(api.subscription).not.toHaveBeenCalled()
    expect(window.location.href).toBe(initialUrl)
    const url = destination('billing-portal')
    request.resolve({ url })
    await expect.poll(() => window.location.href).toBe(url)
  },
)

it('makes an empty portal response visible and lets the subscriber retry', async () => {
  const url = destination('portal-retry')
  api.invoices.mockResolvedValueOnce({ url: '' }).mockResolvedValueOnce({ url })
  await setup({
    features: { billing: { subscription: { plan: 'professional', interval: 'month' } } },
  })
  const manage = page.getByRole('button', { name: 'billing.plansCommon.manageSubscription' })
  await manage.click()
  await expect.element(page.getByText('billing.errors.operationFailed')).toBeVisible()
  expect(window.location.href).toBe(initialUrl)
  await manage.click()
  await expect.poll(() => window.location.href).toBe(url)
})
