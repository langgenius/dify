import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createDeferred } from '@/test/deferred'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { ExportAppDialog } from '../export-app-dialog'

const { getEnvironmentVariables, exportDsl, downloadBlob } = vi.hoisted(() => ({
  getEnvironmentVariables: vi.fn(),
  exportDsl: vi.fn(),
  downloadBlob: vi.fn(),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'apps.byAppId.workflows.draft.environmentVariables.get': getEnvironmentVariables,
      'apps.byAppId.export.get': exportDsl,
    }),
  }
})

// boundary: Downloads leave the browser test page; record the download instead.
vi.mock('@/utils/download', () => ({ downloadBlob }))

const app = createAppDetailFixture({ name: 'Support workflow', mode: 'workflow' })
const warning = 'workflow.sidebar.exportWarning'
const secretWarning = 'app.exportSecret.title'

function Fixture({ client }: { client: QueryClient }) {
  const [open, setOpen] = useState(false)
  return (
    <QueryClientProvider client={client}>
      <button type="button" onClick={() => setOpen(true)}>
        Export workflow
      </button>
      <ExportAppDialog appDetail={app} open={open} onClose={() => setOpen(false)} />
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

beforeEach(() => {
  getEnvironmentVariables.mockReset()
  exportDsl.mockReset()
  downloadBlob.mockReset()
})

it('lets Escape dismiss a delayed secret check without starting an export', async () => {
  const check = createDeferred<{ items: [] }>()
  getEnvironmentVariables.mockReturnValueOnce(check.promise)
  const { client, dialog, trigger } = await setup()
  await dialog.getByRole('button', { name: 'common.operation.confirm' }).click()
  await expect.poll(() => getEnvironmentVariables.mock.calls.length).toBe(1)

  await userEvent.keyboard('{Escape}')
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
  check.resolve({ items: [] })
  await expect.poll(() => client.isMutating()).toBe(0)
  expect(exportDsl).not.toHaveBeenCalled()
  expect(downloadBlob).not.toHaveBeenCalled()
})

it('cancels an in-flight download without affecting the next export session', async () => {
  const request = createDeferred<{ data: string }>()
  getEnvironmentVariables.mockResolvedValue({
    items: [{ name: 'TOKEN', value_type: 'secret', value: 'masked' }],
  })
  exportDsl.mockReturnValueOnce(request.promise)
  const { client, screen, dialog, trigger } = await setup()
  const confirm = dialog.getByRole('button', { name: 'common.operation.confirm' })
  await confirm.click()
  const secretDialog = screen.getByRole('alertdialog', { name: secretWarning })
  await expect.element(secretDialog).toBeVisible()
  await secretDialog.getByRole('checkbox').click()
  await secretDialog.getByRole('button', { name: secretWarning }).click()
  await expect.poll(() => exportDsl.mock.calls.length).toBe(1)

  await secretDialog.getByRole('button', { name: 'common.operation.cancel' }).click()
  await expect.element(secretDialog).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
  await trigger.click()
  await expect.element(dialog).toBeVisible()

  const retry = createDeferred<{ data: string }>()
  exportDsl.mockReturnValueOnce(retry.promise)
  await confirm.click()
  await expect.element(secretDialog).toBeVisible()
  await secretDialog.getByRole('checkbox').click()
  await secretDialog.getByRole('button', { name: secretWarning }).click()
  await expect.poll(() => exportDsl.mock.calls.length).toBe(2)

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
