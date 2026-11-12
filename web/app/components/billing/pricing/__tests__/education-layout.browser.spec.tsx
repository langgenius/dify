import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
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
