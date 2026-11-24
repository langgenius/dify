import type { consoleClient } from '@/service/console'
import { Dialog } from '@langgenius/dify-ui/dialog'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { PricingContent } from '../content'

const api = vi.hoisted(() => ({
  subscription: vi.fn<typeof consoleClient.billing.subscription.get>(),
  invoices: vi.fn<typeof consoleClient.billing.invoices.get>(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'billing.subscription.get': api.subscription,
      'billing.invoices.get': api.invoices,
    }),
  }
})

const initialUrl = window.location.href
beforeEach(() => {
  api.subscription.mockReset()
  api.invoices.mockReset()
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
    api.subscription.mockResolvedValue({ url })
    await setup({ features: { billing: { subscription: { plan, interval: currentInterval } } } })
    const annualBilling = page.getByRole('switch', { name: /billing\.plansCommon\.annualBilling/ })
    await annualBilling.click()
    if (selectedInterval === 'month') await annualBilling.click()
    await page.getByRole('button', { name: 'billing.plansCommon.currentPlan' }).click()
    await expect.poll(() => window.location.href).toBe(url)
    expect(api.subscription).toHaveBeenCalledExactlyOnceWith(
      { query: { plan, interval: selectedInterval } },
      { context: { silent: true } },
    )
    expect(api.invoices).not.toHaveBeenCalled()
  },
)
