import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { TEST_WORKSPACE_ID } from '@/test/console/ids'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { apiError, setupFakeApi } from '@/test/fake-api'
import { WorkspaceAccessRecovery } from '../workspace-access-recovery'

const destinationId = '0b9c1e4a-6d2f-4a8b-9c3e-5f7a1b2c3d4f'
const switchError = 'This workspace could not be opened.'
const currentWorkspace = {
  id: TEST_WORKSPACE_ID,
  name: 'Growth Team',
  plan: 'team',
  current: true,
} as const
const fake = setupFakeApi(() => ({
  console: {
    workspaces: {
      get: () => ({
        workspaces: [
          { id: destinationId, name: 'Solar Studio', plan: 'team', current: false },
          currentWorkspace,
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

async function renderWorkspaceRecovery() {
  const { queryClient, wrapper: Providers } = createConsoleQueryWrapper({})
  onTestFinished(() => queryClient.clear())
  await render(
    <Providers>
      <WorkspaceAccessRecovery />
    </Providers>,
  )
}

it('keeps the current workspace unavailable and lets the user retry a failed switch', async () => {
  await renderWorkspaceRecovery()
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

it('opens workspace creation when the current workspace is the only one and closes after a valid submission', async () => {
  fake.console.workspaces.get.mockResolvedValue({ workspaces: [currentWorkspace] })
  await renderWorkspaceRecovery()

  const trigger = page.getByRole('button', {
    name: 'navigation.workspaceUnavailable.switchWorkspace',
  })
  await trigger.click()
  await expect.element(page.getByRole('menuitemradio', { name: /Growth Team/ })).toBeDisabled()
  const createItem = page.getByRole('menuitem', {
    name: 'navigation.workspaceUnavailable.createWorkspace',
  })
  await createItem.click()

  const dialog = page.getByRole('dialog', {
    name: 'navigation.workspaceUnavailable.createWorkspaceTitle',
  })
  await expect.element(dialog).toBeVisible()
  await expect.element(page.getByRole('menu')).not.toBeInTheDocument()
  const name = dialog.getByRole('textbox', {
    name: 'navigation.workspaceUnavailable.workspaceName',
  })
  const submit = dialog.getByRole('button', {
    name: 'navigation.workspaceUnavailable.createWorkspace',
  })
  await submit.click()
  await expect.element(name).toBeInvalid()
  await expect.element(dialog.getByText(/^common\.errorMsg\.fieldRequired:/)).toBeVisible()
  await name.fill('New workspace')
  await userEvent.keyboard('{Enter}')
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
  expect(fake.console.workspaces.switch.post).not.toHaveBeenCalled()

  await trigger.click()
  await createItem.click()
  await expect.element(name).toHaveValue('')
  await dialog.getByRole('button', { name: 'common.operation.cancel' }).click()
  await expect.element(dialog).not.toBeInTheDocument()
})

it('allows workspace creation when the account has no listed workspaces', async () => {
  fake.console.workspaces.get.mockResolvedValue({ workspaces: [] })
  await renderWorkspaceRecovery()

  const trigger = page.getByRole('button', {
    name: 'navigation.workspaceUnavailable.switchWorkspace',
  })
  await trigger.click()
  const createItem = page.getByRole('menuitem', {
    name: 'navigation.workspaceUnavailable.createWorkspace',
  })
  await createItem.click()
  await expect
    .element(
      page.getByRole('dialog', { name: 'navigation.workspaceUnavailable.createWorkspaceTitle' }),
    )
    .toBeVisible()
})
