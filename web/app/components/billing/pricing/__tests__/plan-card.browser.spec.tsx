import type { consoleClient } from '@/service/console'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { CloudPlanCard } from '../plan-card'
import { PlanFeatureInfotip } from '../plan-card/features'

const api = vi.hoisted(() => ({
  subscription: vi.fn<typeof consoleClient.billing.subscription.get>(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'billing.subscription.get': api.subscription,
    }),
  }
})
beforeEach(() => api.subscription.mockReset())

it('keeps both education checkout actions inside the dialog on a narrow phone', async () => {
  await page.viewport(320, 700)
  const { queryClient, wrapper: Provider } = createConsoleQueryWrapper({
    currentWorkspace: { role: 'owner' },
  })
  onTestFinished(() => queryClient.clear())
  await render(
    <Provider>
      <PlanFeatureInfotip>
        <CloudPlanCard
          plan="team"
          billingInterval="month"
          billing={{
            currentPlan: 'sandbox',
            currentBillingInterval: 'month',
            isEducationDiscountEligible: true,
          }}
        />
      </PlanFeatureInfotip>
    </Provider>,
  )
  await page.getByRole('button', { name: 'billing.plansCommon.upgradeToTeam' }).click()
  const dialog = page.getByRole('dialog')
  await expect.element(dialog).toBeVisible()
  const bounds = dialog.element().getBoundingClientRect()
  for (const name of [
    'education.educationPricingConfirm.cancel',
    'education.educationPricingConfirm.continue',
  ]) {
    const action = dialog.getByRole('button', { name })
    await expect.element(action).toBeVisible()
    const rect = action.element().getBoundingClientRect()
    expect(rect.left).toBeGreaterThanOrEqual(bounds.left)
    expect(rect.right).toBeLessThanOrEqual(bounds.right)
  }
})

it.each(['professional', 'sandbox'] as const)(
  'keeps the Team action legible while a %s workspace requests checkout',
  async (currentPlan) => {
    const { queryClient, wrapper: Provider } = createConsoleQueryWrapper({
      currentWorkspace: { role: 'owner' },
    })
    onTestFinished(() => queryClient.clear())
    await render(
      <Provider>
        <PlanFeatureInfotip>
          <CloudPlanCard
            plan="team"
            billingInterval="month"
            billing={{
              currentPlan,
              currentBillingInterval: 'month',
              isEducationDiscountEligible: false,
            }}
          />
        </PlanFeatureInfotip>
      </Provider>,
    )
    const action = page.getByRole('button', { name: 'billing.plansCommon.upgradeToTeam' })
    const colors = () => {
      const style = getComputedStyle(action.element())
      return [style.color, style.backgroundColor]
    }
    const ready = colors()
    // boundary: keep checkout pending to observe the actual loading button.
    const request =
      createDeferred<Awaited<ReturnType<typeof consoleClient.billing.subscription.get>>>()
    api.subscription.mockReturnValue(request.promise)
    try {
      await action.click()
      await expect.element(action).toHaveAttribute('aria-disabled', 'true')
      await expect.element(action).toHaveFocus()
      expect(colors()).toEqual(ready)
      await userEvent.keyboard('{Enter}')
      expect(api.subscription).toHaveBeenCalledTimes(1)
    } finally {
      request.resolve({ url: '' })
    }
  },
)
