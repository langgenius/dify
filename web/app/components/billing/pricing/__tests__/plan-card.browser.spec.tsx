import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { CloudPlanCard } from '../plan-card'
import { PlanFeatureInfotip } from '../plan-card/features'

// boundary: The education checkout requires a workspace manager with billing access.
vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => ({ isCurrentWorkspaceManager: true }))
})

it('keeps both education checkout actions inside the dialog on a narrow phone', async () => {
  await page.viewport(320, 700)
  const { wrapper: Provider } = createConsoleQueryWrapper()
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
    const { wrapper: Provider } = createConsoleQueryWrapper()
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
    const request = createDeferred<Response>()
    const fetch = vi.spyOn(globalThis, 'fetch').mockReturnValue(request.promise)
    try {
      await action.click()
      await expect.element(action).toHaveAttribute('aria-disabled', 'true')
      await expect.element(action).toHaveFocus()
      expect(colors()).toEqual(ready)
    } finally {
      request.resolve(Response.json({ url: '' }, { status: 503 }))
      fetch.mockRestore()
    }
  },
)
