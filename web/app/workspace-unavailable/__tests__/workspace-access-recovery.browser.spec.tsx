import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { TEST_WORKSPACE_ID } from '@/test/console/ids'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { apiError, setupFakeApi } from '@/test/fake-api'
import { WorkspaceAccessRecovery } from '../workspace-access-recovery'

const destinationId = '0b9c1e4a-6d2f-4a8b-9c3e-5f7a1b2c3d4f'
const switchError = 'This workspace could not be opened.'
const fake = setupFakeApi(() => ({
  console: {
    workspaces: {
      get: () => ({
        workspaces: [
          { id: destinationId, name: 'Solar Studio', plan: 'team', current: false },
          { id: TEST_WORKSPACE_ID, name: 'Growth Team', plan: 'team', current: true },
        ],
      }),
      switch: {
        post: () => {
          throw apiError({ status: 409, message: switchError })
        },
      },
    },
  },
}))

it('keeps the current workspace unavailable and lets the user retry a failed switch', async () => {
  const { queryClient, wrapper: Providers } = createConsoleQueryWrapper({})
  onTestFinished(() => queryClient.clear())
  await render(
    <Providers>
      <WorkspaceAccessRecovery />
    </Providers>,
  )

  const trigger = page.getByRole('combobox', {
    name: 'navigation.workspaceUnavailable.switchWorkspace',
  })
  await expect.element(trigger).toBeEnabled()
  await userEvent.keyboard('{Tab}')
  await expect.element(trigger).toHaveFocus()
  await userEvent.keyboard('{Enter}')

  const current = page.getByRole('option', { name: /Growth Team/ })
  const destination = page.getByRole('option', { name: /Solar Studio/ })
  await expect.element(current).toBeDisabled()
  await expect.element(current).toHaveAttribute('aria-selected', 'true')
  await expect.element(destination).toBeEnabled()
  expect(fake.console.workspaces.switch.post).not.toHaveBeenCalled()

  await destination.click()
  await expect.element(page.getByRole('alert')).toHaveTextContent(switchError)
  await expect
    .poll(() => fake.console.workspaces.switch.post)
    .toHaveBeenCalledExactlyOnceWith({ body: { tenant_id: destinationId } })

  await trigger.click()
  await expect.element(current).toHaveAttribute('aria-selected', 'true')
  await destination.click()
  await expect.poll(() => fake.console.workspaces.switch.post).toHaveBeenCalledTimes(2)
  await expect.element(page.getByRole('alert')).toHaveTextContent(switchError)
})
