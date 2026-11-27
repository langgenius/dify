import type { ReactNode } from 'react'
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@langgenius/dify-ui/dialog'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createStepByStepTourService } from '@/test/fixtures/onboarding'
import { createTestNavigation } from '@/test/next-navigation'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import StepByStepTourMount from '../mount'

function renderTour(children?: ReactNode) {
  onTestFinished(guardUnexpectedFetch())
  const { queryClient, wrapper: Providers } = createConsoleQueryWrapper({
    currentWorkspace: { id: 'workspace-1', role: 'owner' },
    systemFeatures: { deployment_edition: 'CLOUD', enable_step_by_step_tour: true },
    features: { education: { enabled: false } },
  })
  queryClient.setQueryData(
    consoleQuery.onboarding.stepByStepTour.state.get.queryKey(),
    createStepByStepTourService({ manually_enabled_workspace_ids: ['workspace-1'] }).state,
  )
  return render(
    <Providers>
      <NuqsTestingAdapter>
        {children}
        <div className="fixed inset-s-2.5 bottom-25">
          <StepByStepTourMount className="h-8" />
        </div>
      </NuqsTestingAdapter>
    </Providers>,
    { wrapper: createTestNavigation({ url: '/apps' }).NavigationProvider },
  )
}

it('visually hides the expanded tour behind a modal and restores it when the modal closes', async () => {
  const screen = await renderTour(
    <Dialog>
      <DialogTrigger style={{ position: 'fixed', right: 12, bottom: 12 }}>
        Open editor
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Editor</DialogTitle>
      </DialogContent>
    </Dialog>,
  )
  const checklist = screen.getByRole('dialog', { name: 'onboarding.stepByStepTour.title' })
  await expect.element(checklist).toBeVisible()
  const checklistElement = checklist.element()
  const trigger = screen.getByRole('button', { name: 'Open editor' })
  await trigger.click()
  await expect.element(screen.getByRole('dialog', { name: 'Editor' })).toBeVisible()
  await expect
    .poll(() => checklistElement.checkVisibility({ visibilityProperty: true }))
    .toBe(false)
  await userEvent.keyboard('{Escape}')
  await expect.element(checklist).toBeVisible()
  await expect.element(trigger).toHaveFocus()
})

it('reopens the checklist on the first click after minimizing it', async () => {
  vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false)
  onTestFinished(() => {
    vi.unstubAllGlobals()
  })
  const screen = await renderTour()
  const checklist = screen.getByRole('dialog', { name: 'onboarding.stepByStepTour.title' })
  const minimize = screen.getByRole('button', { name: 'onboarding.stepByStepTour.minimize' })
  const trigger = screen.getByRole('button', { name: /^onboarding\.stepByStepTour\.title / })

  await expect.element(checklist).toBeVisible()
  await minimize.click()
  await expect.element(trigger).toHaveAttribute('aria-expanded', 'false')
  await trigger.click()
  await expect.element(checklist).toBeVisible()
})
