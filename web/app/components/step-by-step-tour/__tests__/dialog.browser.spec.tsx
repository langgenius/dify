import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@langgenius/dify-ui/dialog'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createStepByStepTourService } from '@/test/fixtures/onboarding'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import StepByStepTourMount from '../mount'

vi.mock('@/next/navigation', () => ({
  usePathname: () => '/apps',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))

it('visually hides the expanded tour behind a modal and restores it when the modal closes', async () => {
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
  const screen = await render(
    <Providers>
      <NuqsTestingAdapter>
        <Dialog>
          <DialogTrigger style={{ position: 'fixed', right: 12, bottom: 12 }}>
            Open editor
          </DialogTrigger>
          <DialogContent>
            <DialogTitle>Editor</DialogTitle>
          </DialogContent>
        </Dialog>
        <StepByStepTourMount />
      </NuqsTestingAdapter>
    </Providers>,
  )
  const region = screen.getByRole('region')
  await expect.element(region).toBeVisible()
  const checklist = region.element()
  const trigger = screen.getByRole('button', { name: 'Open editor' })
  await trigger.click()
  await expect.element(screen.getByRole('dialog', { name: 'Editor' })).toBeVisible()
  await expect.poll(() => checklist.checkVisibility({ visibilityProperty: true })).toBe(false)
  await userEvent.keyboard('{Escape}')
  await expect.element(region).toBeVisible()
  await expect.element(trigger).toHaveFocus()
})
