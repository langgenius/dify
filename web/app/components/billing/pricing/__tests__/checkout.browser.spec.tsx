import type { consoleClient } from '@/service/console'
import { Dialog } from '@langgenius/dify-ui/dialog'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { AppToaster } from '@/app/notifications/app-toaster'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { setupFakeApi } from '@/test/fake-api'
import { PricingContent } from '../content'

const fake = setupFakeApi(() => ({
  console: {
    billing: {
      subscription: { get: async () => ({ url: '' }) },
      invoices: { get: async () => ({ url: '' }) },
    },
    account: {
      education: {
        get: () => ({
          is_student: false,
          allow_refresh: false,
          can_redeem_discount: false,
          expire_at: null,
          result: false,
        }),
      },
    },
  },
}))

const initialUrl = window.location.href
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
    fake.console.billing.subscription.get.mockResolvedValue({ url })
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
    await expect
      .poll(() => fake.console.billing.subscription.get)
      .toHaveBeenCalledExactlyOnceWith({ query: { plan: 'team', interval } })
    expect(fake.console.account.education.get).not.toHaveBeenCalled()
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
  },
)

it('offers education pricing before Team checkout and serializes the selected purchase', async () => {
  const request =
    createDeferred<Awaited<ReturnType<typeof consoleClient.billing.subscription.get>>>()
  fake.console.billing.subscription.get.mockReturnValue(request.promise)
  await setup({
    features: { education: { enabled: true, activated: false } },
    educationStatus: { is_student: true, can_redeem_discount: true },
  })
  await page.getByRole('button', { name: 'billing.plansCommon.upgradeToTeam' }).click()
  const dialog = page.getByRole('dialog', { name: 'education.educationPricingConfirm.title' })
  await expect.element(dialog).toBeVisible()
  expect(fake.console.billing.subscription.get).not.toHaveBeenCalled()
  await dialog.getByRole('button', { name: 'education.educationPricingConfirm.cancel' }).click()
  await expect
    .element(dialog.getByRole('button', { name: 'education.educationPricingConfirm.continue' }))
    .toBeDisabled()
  await expect
    .poll(() => fake.console.billing.subscription.get)
    .toHaveBeenCalledExactlyOnceWith({ query: { plan: 'team', interval: 'year' } })
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
    fake.console.billing.subscription.get.mockResolvedValue({ url })
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
    expect(fake.console.billing.subscription.get).not.toHaveBeenCalled()
    await dialog.getByRole('button', { name: 'billing.pricing.cycleNotice.back' }).click()
    await expect.element(dialog).not.toBeInTheDocument()
    expect(fake.console.billing.subscription.get).not.toHaveBeenCalled()
    await manage.click()
    await dialog.getByRole('button', { name: 'billing.plansCommon.manageSubscription' }).click()
    await expect.poll(() => window.location.href).toBe(url)
    await expect
      .poll(() => fake.console.billing.subscription.get)
      .toHaveBeenCalledExactlyOnceWith({ query: { plan, interval: selectedInterval } })
    expect(fake.console.billing.invoices.get).not.toHaveBeenCalled()
  },
)

it.each(['month', 'year'] as const)(
  'opens the portal once for the current %s subscription',
  async (interval) => {
    const request = createDeferred<Awaited<ReturnType<typeof consoleClient.billing.invoices.get>>>()
    fake.console.billing.invoices.get.mockReturnValue(request.promise)
    await setup({ features: { billing: { subscription: { plan: 'professional', interval } } } })
    const manage = page.getByRole('button', { name: 'billing.plansCommon.manageSubscription' })
    await manage.click()
    await expect.element(manage).toHaveAttribute('aria-disabled', 'true')
    await expect.element(manage).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => fake.console.billing.invoices.get).toHaveBeenCalledTimes(1)
    expect(fake.console.billing.subscription.get).not.toHaveBeenCalled()
    expect(window.location.href).toBe(initialUrl)
    const url = destination('billing-portal')
    request.resolve({ url })
    await expect.poll(() => window.location.href).toBe(url)
  },
)

it('makes an empty portal response visible and lets the subscriber retry', async () => {
  const url = destination('portal-retry')
  fake.console.billing.invoices.get
    .mockResolvedValueOnce({ url: '' })
    .mockResolvedValueOnce({ url })
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
