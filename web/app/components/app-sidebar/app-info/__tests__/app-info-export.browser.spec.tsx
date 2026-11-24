import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { seedSystemFeatures } from '@/test/console/query-data'
import { hold, setupFakeApi } from '@/test/fake-api'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { createTestNavigation } from '@/test/next-navigation'
import { createAppInfoDialogHandles } from '../app-info-dialog-handles'
import { AppInfoDialogs } from '../app-info-dialogs'

const { downloadBlob } = vi.hoisted(() => ({ downloadBlob: vi.fn() }))

// boundary: Downloads leave the browser test page; record the download instead.
vi.mock('@/utils/download', () => ({ downloadBlob }))

const app = createAppDetailFixture({ name: 'Support workflow', mode: 'workflow' })
const secret = {
  id: 'token',
  name: 'TOKEN',
  type: 'secret',
  value_type: 'secret',
  value: 'masked',
  description: '',
  selector: ['env', 'TOKEN'],
  editable: true,
  edited: false,
  visible: true,
}
const fake = setupFakeApi({
  console: {
    apps: {
      byAppId: {
        workflows: { draft: { environmentVariables: { get: () => ({ items: [] }) } } },
        export: { get: () => ({ data: 'exported' }) },
      },
    },
  },
})
const environmentVariables = () =>
  fake.console.apps.byAppId.workflows.draft.environmentVariables.get
const exportDsl = () => fake.console.apps.byAppId.export.get
const warning = 'workflow.sidebar.exportWarning'
const secretWarning = 'app.exportSecret.title'

function Fixture({ client }: { client: QueryClient }) {
  const [handles] = useState(createAppInfoDialogHandles)
  return (
    <QueryClientProvider client={client}>
      <button type="button" onClick={() => handles.export.openWithPayload(null)}>
        Export workflow
      </button>
      <AppInfoDialogs appDetail={app} handles={handles} />
    </QueryClientProvider>
  )
}

async function setup() {
  const client = new QueryClient()
  seedSystemFeatures(client)
  const { NavigationProvider } = createTestNavigation({ url: `/app/${app.id}/workflow` })
  const screen = await render(
    <NavigationProvider>
      <Fixture client={client} />
    </NavigationProvider>,
  )
  const trigger = screen.getByRole('button', { name: 'Export workflow' })
  await trigger.click()
  const dialog = screen.getByRole('alertdialog', { name: warning })
  await expect.element(dialog).toBeVisible()
  return { client, screen, dialog, trigger }
}

it('lets Escape dismiss a delayed secret check without starting an export', async () => {
  const check = hold(environmentVariables())
  const { client, dialog, trigger } = await setup()
  await dialog.getByRole('button', { name: 'common.operation.confirm' }).click()
  await check.arrived

  await userEvent.keyboard('{Escape}')
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
  check.resolve({ items: [] })
  await expect.poll(() => client.isMutating()).toBe(0)
  expect(exportDsl()).not.toHaveBeenCalled()
  expect(downloadBlob).not.toHaveBeenCalled()
})

it('moves to the secret step without returning focus to the opener, keeps it open until its download settles and restarts at the warning', async () => {
  environmentVariables().mockResolvedValue({ items: [secret] })
  const request = hold(exportDsl())
  const { screen, dialog, trigger } = await setup()
  const triggerFocus = vi.fn()
  const triggerElement = [...document.querySelectorAll('button')].find(
    (button) => button.textContent === 'Export workflow',
  )!
  triggerElement.addEventListener('focus', triggerFocus)
  await dialog.getByRole('button', { name: 'common.operation.confirm' }).click()
  const secretDialog = screen.getByRole('alertdialog', { name: secretWarning })
  await expect.element(secretDialog).toBeVisible()
  expect(triggerFocus).not.toHaveBeenCalled()
  await secretDialog.getByRole('checkbox').click()
  await secretDialog.getByRole('button', { name: secretWarning }).click()
  await request.arrived

  await expect
    .element(secretDialog.getByRole('button', { name: 'common.operation.cancel' }))
    .toBeDisabled()
  await userEvent.keyboard('{Escape}')
  await expect.element(secretDialog).toBeVisible()

  request.resolve({ data: 'exported' })
  await expect.element(secretDialog).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
  expect(downloadBlob).toHaveBeenCalledExactlyOnceWith({
    data: expect.any(Blob),
    fileName: 'Support workflow.yml',
  })

  await trigger.click()
  await expect.element(dialog).toBeVisible()
})
