import { Dialog } from '@langgenius/dify-ui/dialog'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { setupFakeApi } from '@/test/fake-api'
import { PricingContent } from '../content'

const fake = setupFakeApi(() => ({
  console: {
    billing: {
      subscription: { get: async () => ({ url: '' }) },
      invoices: { get: async () => ({ url: '' }) },
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
      </Dialog>
    </Providers>,
  )
}

// Same-document response URLs let Chromium perform the real location assignment without
// leaving the component runner. The billing service still supplies the destination.
const destination = (hash: string) => new URL(`#${hash}`, initialUrl).href

it.each([
  ['professional', 'month', 'year'],
  ['professional', 'year', 'month'],
  ['team', 'month', 'year'],
  ['team', 'year', 'month'],
] as const)(
  'requests the selected %s billing change from %s to %s',
  async (plan, currentInterval, selectedInterval) => {
    const url = destination('confirmed-cycle')
    fake.console.billing.subscription.get.mockResolvedValue({ url })
    await setup({ features: { billing: { subscription: { plan, interval: currentInterval } } } })
    const annualBilling = page.getByRole('switch', { name: /billing\.plansCommon\.annualBilling/ })
    await expect.element(annualBilling).not.toBeChecked()
    await annualBilling.click()
    if (selectedInterval === 'month') await annualBilling.click()
    await page.getByRole('button', { name: 'billing.plansCommon.currentPlan' }).click()
    await expect.poll(() => window.location.href).toBe(url)
    await expect
      .poll(() => fake.console.billing.subscription.get)
      .toHaveBeenCalledExactlyOnceWith({ query: { plan, interval: selectedInterval } })
    expect(fake.console.billing.invoices.get).not.toHaveBeenCalled()
  },
)
