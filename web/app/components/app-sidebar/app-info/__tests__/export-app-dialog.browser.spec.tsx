import { AlertDialog, createAlertDialogHandle } from '@langgenius/dify-ui/alert-dialog'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { hold, setupFakeApi } from '@/test/fake-api'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { ExportAppDialogContent } from '../export-app-dialog'

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
  const [handle] = useState(() => createAlertDialogHandle())
  return (
    <QueryClientProvider client={client}>
      <button type="button" onClick={() => handle.open(null)}>
        Export workflow
      </button>
      <AlertDialog handle={handle}>
        <ExportAppDialogContent appDetail={app} onExported={() => handle.close()} />
      </AlertDialog>
    </QueryClientProvider>
  )
}

async function setup() {
  const client = new QueryClient()
  const screen = await render(<Fixture client={client} />)
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

it('cancels an in-flight download without affecting the next export session', async () => {
  environmentVariables().mockResolvedValue({ items: [secret] })
  const request = hold(exportDsl())
  const { client, screen, dialog, trigger } = await setup()
  const confirm = dialog.getByRole('button', { name: 'common.operation.confirm' })
  await confirm.click()
  const secretDialog = screen.getByRole('alertdialog', { name: secretWarning })
  await expect.element(secretDialog).toBeVisible()
  await secretDialog.getByRole('checkbox').click()
  await secretDialog.getByRole('button', { name: secretWarning }).click()
  await request.arrived

  await secretDialog.getByRole('button', { name: 'common.operation.cancel' }).click()
  await expect.element(secretDialog).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
  await trigger.click()
  await expect.element(dialog).toBeVisible()

  const retry = hold(exportDsl())
  await confirm.click()
  await expect.element(secretDialog).toBeVisible()
  await secretDialog.getByRole('checkbox').click()
  await secretDialog.getByRole('button', { name: secretWarning }).click()
  await retry.arrived

  request.resolve({ data: 'abandoned export' })
  await expect.poll(() => client.isMutating()).toBe(1)
  await expect.element(secretDialog).toBeVisible()
  expect(downloadBlob).not.toHaveBeenCalled()

  retry.resolve({ data: 'new export' })
  await expect.element(secretDialog).not.toBeInTheDocument()
  expect(downloadBlob).toHaveBeenCalledExactlyOnceWith({
    data: expect.any(Blob),
    fileName: 'Support workflow.yml',
  })
  const [download] = downloadBlob.mock.calls[0]!
  expect(await download.data.text()).toBe('new export')
})
