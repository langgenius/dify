import type { AppInfoOperation } from '../app-info-modals'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { mockEmojiData } from '@/test/emoji-picker'
import { createAppDetailFixture } from '@/test/fixtures/app'
import AppInfoModals from '../app-info-modals'
import { AppMetadataDialog } from '../app-metadata-dialog'
import { DeleteAppDialog } from '../delete-app-dialog'
import { ExportAppDialog } from '../export-app-dialog'

const service = vi.hoisted(() => ({
  request: vi.fn(),
  replace: vi.fn(),
  exportWorkflow: vi.fn(),
  exportApp: vi.fn(),
  notify: vi.fn(),
}))
vi.mock('@/next/navigation', () => ({ useRouter: () => ({ replace: service.replace }) }))
vi.mock('@/app/notifications', () => ({
  toast: { error: service.notify, success: service.notify },
}))
vi.mock('@/app/components/app/use-export-app-dsl', () => ({
  useExportWorkflowAppDsl: () => ({
    exportWorkflowAppDsl: service.exportWorkflow,
    isExporting: false,
    reset: vi.fn(),
  }),
  useExportAppDsl: () => ({ exportAppDsl: service.exportApp, isExporting: false, reset: vi.fn() }),
}))
vi.mock('@/service/base', () => ({ request: (...args: unknown[]) => service.request(...args) }))
vi.mock('@/app/components/workflow/collaboration/core/websocket-manager', () => ({
  webSocketClient: { getSocket: () => null },
}))

const app = createAppDetailFixture({
  name: 'Test app',
  description: 'Saved description',
  mode: 'workflow',
  icon_type: 'emoji',
  icon: '🚀',
  icon_background: '#FFEAD5',
  permission_keys: ['app.acl.view_layout'],
})
function MetadataEntry({ operation = 'edit' }: { operation?: 'edit' | 'duplicate' }) {
  const [open, setOpen] = useState(true)
  return (
    <>
      <button onClick={() => setOpen(true)}>Reopen</button>
      <AppMetadataDialog appDetail={app} operation={operation} open={open} onOpenChange={setOpen} />
    </>
  )
}
function DeleteEntry() {
  const [open, setOpen] = useState(true)
  return <DeleteAppDialog appDetail={app} open={open} onOpenChange={setOpen} />
}
function ExportEntry() {
  const [open, setOpen] = useState(true)
  return <ExportAppDialog appDetail={app} open={open} onOpenChange={setOpen} />
}
const render = (ui: React.ReactElement) =>
  renderWithConsoleQuery(ui, {
    queryClient: createConsoleQueryClient(),
    systemFeatures: { deployment_edition: 'COMMUNITY', rbac_enabled: false },
  })

beforeEach(() => {
  service.replace.mockReset()
  service.request.mockReset()
  service.exportApp.mockReset()
  service.exportWorkflow.mockReset()
})

it('keeps the edit draft on failure, guards pending dismissal and closes only after a successful save', async () => {
  const user = userEvent.setup()
  let reject: (error: Error) => void = () => {}
  service.request.mockImplementationOnce(
    () =>
      new Promise((_resolve, rejectRequest) => {
        reject = rejectRequest
      }),
  )
  render(<MetadataEntry />)
  const name = await screen.findByRole('textbox', { name: 'app.newApp.captionName' })
  await user.clear(name)
  await user.type(name, 'Retried name')
  await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
  await waitFor(() => expect(service.request).toHaveBeenCalledTimes(1))
  expect(name).toHaveAttribute('readonly')
  await user.keyboard('{Escape}')
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  await act(async () => reject(new Error('Unavailable')))
  await waitFor(() => expect(name).not.toHaveAttribute('readonly'))
  expect(name).toHaveValue('Retried name')
  service.request.mockResolvedValueOnce(Response.json({ ...app, name: 'Retried name' }))
  await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

it('keeps the edit draft after an outside press and still allows explicit cancellation', async () => {
  const user = userEvent.setup()
  render(<MetadataEntry />)
  const name = await screen.findByRole('textbox', { name: 'app.newApp.captionName' })
  await user.clear(name)
  await user.type(name, 'Unsaved draft')
  await user.click(document.body)
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  expect(name).toHaveValue('Unsaved draft')
  expect(service.request).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

it('discards a cancelled draft and initializes the next edit session from saved data', async () => {
  const user = userEvent.setup()
  render(<MetadataEntry />)
  const name = await screen.findByRole('textbox', { name: 'app.newApp.captionName' })
  await user.clear(name)
  await user.type(name, 'Discarded')
  await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await user.click(screen.getByRole('button', { name: 'Reopen' }))
  expect(await screen.findByRole('textbox', { name: 'app.newApp.captionName' })).toHaveValue(
    app.name,
  )
})

it('keeps the duplicate name after a failed copy', async () => {
  const user = userEvent.setup()
  service.request.mockRejectedValueOnce(new Error('Unavailable'))
  render(<MetadataEntry operation="duplicate" />)
  const name = await screen.findByRole('textbox', { name: 'app.newApp.captionName' })
  await user.clear(name)
  await user.type(name, 'Copy draft{Enter}')
  await waitFor(() => expect(service.request).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(name).not.toHaveAttribute('readonly'))
  expect(name).toHaveValue('Copy draft')
  expect(screen.getByRole('dialog')).toBeInTheDocument()
})

it('retains deletion confirmation after failure and prevents repeated submission while pending', async () => {
  const user = userEvent.setup()
  let reject: (error: Error) => void = () => {}
  service.request.mockImplementationOnce(
    () =>
      new Promise((_resolve, rejectRequest) => {
        reject = rejectRequest
      }),
  )
  render(<DeleteEntry />)
  await user.click(screen.getByRole('button', { name: 'common.operation.fill' }))
  await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))
  await waitFor(() => expect(service.request).toHaveBeenCalledTimes(1))
  await user.keyboard('{Escape}')
  expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  await act(async () => reject(new Error('Unavailable')))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'common.operation.cancel' })).not.toBeDisabled(),
  )
  expect(screen.getByRole('textbox')).toHaveValue(app.name)
  expect(service.replace).not.toHaveBeenCalled()
})

it('submits the secret choice and keeps the export confirmation open after a failed download', async () => {
  const user = userEvent.setup()
  service.exportWorkflow.mockResolvedValue({
    status: 'confirmation-required',
    secretEnvList: [{ name: 'API_TOKEN', value: 'masked', value_type: 'secret' }],
  })
  service.exportApp.mockResolvedValue({ status: 'failed' })
  render(<ExportEntry />)
  await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))
  const dialog = await screen.findByRole('alertdialog', { name: 'app.exportSecret.title' })
  await user.click(within(dialog).getByRole('checkbox'))
  await user.click(within(dialog).getByRole('button', { name: 'app.exportSecret.title' }))
  await waitFor(() =>
    expect(service.exportApp).toHaveBeenCalledWith({
      appId: app.id,
      appName: app.name,
      includeSecret: true,
      feedback: 'dialog',
    }),
  )
  expect(dialog).toBeInTheDocument()
})

function OperationsEntry({ operation }: { operation: AppInfoOperation }) {
  const [activeModal, setActiveModal] = useState<AppInfoOperation | null>(null)
  return (
    <>
      <button onClick={() => setActiveModal(operation)}>Open operation</button>
      <AppInfoModals
        appDetail={app}
        activeModal={activeModal}
        onOpenChange={(open) => {
          if (!open) setActiveModal(null)
        }}
        exportOpen={false}
        onExportOpenChange={() => {}}
      />
    </>
  )
}

it.each(['edit', 'duplicate', 'switch', 'delete', 'importDSL'] as const)(
  'animates the first %s opening and focuses its input control',
  async (operation) => {
    render(<OperationsEntry operation={operation} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open operation' }))
    const dialog = screen.getByRole(operation === 'delete' ? 'alertdialog' : 'dialog')
    expect(dialog).toHaveAttribute('data-starting-style')
    const target =
      operation === 'importDSL'
        ? within(dialog).getByRole('button', { name: 'app.dslUploader.browse' })
        : within(dialog).getByRole(
            'textbox',
            operation === 'delete'
              ? {}
              : { name: operation === 'switch' ? 'app.switchLabel' : 'app.newApp.captionName' },
          )
    await waitFor(() => expect(target).toHaveFocus())
  },
)

it('preserves the selected import file while opening and cancelling its nested backup dialog', async () => {
  const user = userEvent.setup()
  render(<OperationsEntry operation="importDSL" />)
  await user.click(screen.getByRole('button', { name: 'Open operation' }))
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!
  await user.upload(input, new File(['workflow: {}'], 'draft.yaml', { type: 'application/yaml' }))
  await user.click(screen.getByRole('button', { name: 'workflow.common.backupCurrentDraft' }))
  expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  expect(screen.getByText('draft.yaml')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'workflow.common.backupCurrentDraft' })).toHaveFocus()
  await user.click(screen.getByRole('button', { name: 'app.newApp.Cancel' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await user.click(screen.getByRole('button', { name: 'Open operation' }))
  expect(screen.queryByText('draft.yaml')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'workflow.common.overwriteAndImport' })).toBeDisabled()
})

it('validates the edit form and submits current values after choosing an icon', async () => {
  const user = userEvent.setup()
  service.request.mockResolvedValueOnce(Response.json(app))
  render(<MetadataEntry />)
  const name = await screen.findByRole('textbox', { name: 'app.newApp.captionName' })
  await user.clear(name)
  await user.keyboard('{Enter}')
  expect(service.request).not.toHaveBeenCalled()
  await user.type(name, 'Edited name')
  await user.click(screen.getByRole('button', { name: 'app.iconPicker.title' }))
  await user.click(await screen.findByRole('radio', { name: 'app.iconPicker.color.green' }))
  await user.click(screen.getByRole('button', { name: /iconPicker\.ok/ }))
  await waitFor(() =>
    expect(screen.queryByPlaceholderText('app.iconPicker.search')).not.toBeInTheDocument(),
  )
  expect(service.request).not.toHaveBeenCalled()
  await user.click(name)
  await user.keyboard('{Enter}')
  await waitFor(() => expect(service.request).toHaveBeenCalledTimes(1))
  const request = service.request.mock.calls.at(0)?.[2]?.request
  expect(request).toBeInstanceOf(Request)
  const payload = await request.json()
  expect(payload).toMatchObject({
    name: 'Edited name',
    description: 'Saved description',
    icon_background: '#F3FEE7',
  })
  expect(payload.max_active_requests).not.toBeNull()
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

mockEmojiData()

it.each(['duplicate', 'delete'] as const)(
  'preserves shared cache invalidation after a successful %s',
  async (operation) => {
    const user = userEvent.setup()
    const queryClient = createConsoleQueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    service.request.mockResolvedValueOnce(
      Response.json(operation === 'duplicate' ? app : { result: 'success' }),
    )
    renderWithConsoleQuery(
      operation === 'duplicate' ? <MetadataEntry operation="duplicate" /> : <DeleteEntry />,
      {
        queryClient,
        systemFeatures: { deployment_edition: 'COMMUNITY', rbac_enabled: false },
      },
    )
    if (operation === 'delete')
      await user.click(screen.getByRole('button', { name: 'common.operation.fill' }))
    await user.click(
      screen.getByRole('button', {
        name: operation === 'delete' ? 'common.operation.confirm' : 'app.duplicate',
      }),
    )
    await waitFor(() =>
      expect(service.replace).toHaveBeenCalledWith(
        operation === 'delete' ? '/apps' : `/app/${app.id}/workflow`,
      ),
    )
    for (const queryKey of [
      consoleQuery.apps.get.key(),
      consoleQuery.apps.starred.get.key(),
      consoleQuery.apps.recent.get.key(),
      consoleQuery.features.get.key(),
    ]) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey })
    }
  },
)
