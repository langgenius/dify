import type { ComponentProps } from 'react'
import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createToolProviderFixture } from '@/test/console/tool-provider-fixture'
import { createDeferred } from '@/test/deferred'
import { selectToolsWithProvider } from '../../utils/query-select'
import MCPList from '../index'

const api = vi.hoisted(() => ({
  list: vi.fn<typeof import('@/service/console').consoleClient.workspaces.current.tools.mcp.get>(),
  update:
    vi.fn<
      typeof import('@/service/console').consoleClient.workspaces.current.toolProvider.mcp.put
    >(),
  remove:
    vi.fn<
      typeof import('@/service/console').consoleClient.workspaces.current.toolProvider.mcp.delete
    >(),
  authorize:
    vi.fn<
      typeof import('@/service/console').consoleClient.workspaces.current.toolProvider.mcp.auth.post
    >(),
  updateTools:
    vi.fn<
      typeof import('@/service/console').consoleClient.workspaces.current.toolProvider.mcp.update.byProviderId.get
    >(),
  tools:
    vi.fn<
      typeof import('@/service/console').consoleClient.workspaces.current.toolProvider.mcp.tools.byProviderId.get
    >(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.tools.mcp.get': api.list,
      'workspaces.current.toolProvider.mcp.put': api.update,
      'workspaces.current.toolProvider.mcp.delete': api.remove,
      'workspaces.current.toolProvider.mcp.auth.post': api.authorize,
      'workspaces.current.toolProvider.mcp.update.byProviderId.get': api.updateTools,
      'workspaces.current.toolProvider.mcp.tools.byProviderId.get': api.tools,
    }),
  }
})
const provider = createToolProviderFixture({
  id: 'mcp-database-id',
  name: 'Weather MCP',
  type: 'mcp',
  label: { en_US: 'Weather MCP' },
  server_identifier: 'weather',
  server_url: 'https://weather.example.com',
  is_team_authorization: false,
})
const connectedProvider = createToolProviderFixture({ ...provider, is_team_authorization: true })

const renderList = (
  props: Partial<ComponentProps<typeof MCPList>> = {},
  permissions = ['mcp.manage'],
  seed = true,
) => {
  const queryClient = createConsoleQueryClient()
  if (seed)
    queryClient.setQueryData(consoleQuery.workspaces.current.tools.mcp.get.queryKey(), [provider])
  return renderWithConsoleQuery(<MCPList searchText="" {...props} />, {
    queryClient,
    workspacePermissionKeys: permissions,
  })
}

beforeEach(() => {
  api.list.mockReset().mockResolvedValue([provider])
  api.update.mockReset().mockResolvedValue({ result: 'success' })
  api.remove.mockReset().mockResolvedValue({ result: 'success' })
  api.authorize.mockReset().mockResolvedValue({ result: 'success' })
  api.updateTools.mockReset().mockResolvedValue(connectedProvider)
  api.tools.mockReset().mockResolvedValue(connectedProvider)
})
afterEach(async () => {
  await act(async () => cleanup())
})

it('loads the fallback catalog for read-only users and prevents management and authorization', async () => {
  const user = userEvent.setup()
  const response = createDeferred<Awaited<ReturnType<typeof api.list>>>()
  api.list.mockReturnValue(response.promise)
  renderList({}, [], false)
  expect(screen.queryByRole('button', { name: /Weather MCP/ })).not.toBeInTheDocument()
  await act(async () => response.resolve([provider]))
  await user.click(await screen.findByRole('button', { name: /Weather MCP/ }))
  const detail = await screen.findByRole('dialog')
  expect(within(detail).getByText('Weather MCP')).toBeInTheDocument()
  expect(within(detail).getByRole('button', { name: 'tools.mcp.authorize' })).toBeDisabled()
  expect(
    within(detail).queryByRole('button', { name: 'common.operation.more' }),
  ).not.toBeInTheDocument()
  await user.click(within(detail).getByRole('button', { name: 'common.operation.close' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(
    screen.queryByRole('button', { name: 'tools.mcp.create.cardTitle' }),
  ).not.toBeInTheDocument()
  expect(api.authorize).not.toHaveBeenCalled()
})

it('filters the parent catalog without requesting a fallback list', async () => {
  const providers = selectToolsWithProvider([
    provider,
    createToolProviderFixture({ ...provider, id: 'second', name: 'Calendar MCP' }),
  ])
  const { rerender } = renderList({ providers, searchText: 'WEATHER', showCreateCard: false })
  expect(screen.getByRole('button', { name: /Weather MCP/ })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Calendar MCP/ })).not.toBeInTheDocument()
  rerender(<MCPList providers={providers} searchText="calendar" showCreateCard={false} />)
  expect(screen.getByRole('button', { name: /Calendar MCP/ })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Weather MCP/ })).not.toBeInTheDocument()
  await act(async () => {})
  expect(api.list).not.toHaveBeenCalled()
})

it('opens editing from a card without selecting the details', async () => {
  const user = userEvent.setup()
  renderList()
  await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
  await user.click(await screen.findByRole('menuitem', { name: 'tools.mcp.operation.edit' }))
  const edit = await screen.findByRole('dialog', { name: 'tools.mcp.modal.editTitle' })
  expect(within(edit).getByRole('textbox', { name: 'tools.mcp.modal.name' })).toHaveValue(
    'Weather MCP',
  )
  await user.click(within(edit).getByRole('button', { name: 'tools.mcp.modal.cancel' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(api.update).not.toHaveBeenCalled()
})

it('restores the selected details after cancelling an edit and discards the unsaved name', async () => {
  const user = userEvent.setup()
  renderList()
  await user.click(screen.getByRole('button', { name: /Weather MCP/ }))
  let detail = await screen.findByRole('dialog')
  await user.click(within(detail).getByRole('button', { name: 'common.operation.more' }))
  await user.click(await screen.findByRole('menuitem', { name: 'tools.mcp.operation.edit' }))
  let edit = await screen.findByRole('dialog', { name: 'tools.mcp.modal.editTitle' })
  await user.clear(within(edit).getByRole('textbox', { name: 'tools.mcp.modal.name' }))
  await user.type(within(edit).getByRole('textbox', { name: 'tools.mcp.modal.name' }), 'Unsaved')
  await user.click(within(edit).getByRole('button', { name: 'tools.mcp.modal.cancel' }))
  await waitFor(() =>
    expect(
      screen.queryByRole('dialog', { name: 'tools.mcp.modal.editTitle' }),
    ).not.toBeInTheDocument(),
  )
  detail = await screen.findByRole('dialog')
  expect(within(detail).getByText('Weather MCP')).toBeInTheDocument()
  await user.click(within(detail).getByRole('button', { name: 'common.operation.more' }))
  await user.click(await screen.findByRole('menuitem', { name: 'tools.mcp.operation.edit' }))
  edit = await screen.findByRole('dialog', { name: 'tools.mcp.modal.editTitle' })
  expect(within(edit).getByRole('textbox', { name: 'tools.mcp.modal.name' })).toHaveValue(
    'Weather MCP',
  )
  expect(api.update).not.toHaveBeenCalled()
})

it('saves the edited provider, refreshes its details and authorizes it once', async () => {
  const user = userEvent.setup()
  const updated = createToolProviderFixture({ ...provider, name: 'Updated MCP' })
  const connected = createToolProviderFixture({ ...updated, is_team_authorization: true })
  api.list.mockResolvedValue([updated])
  api.updateTools.mockImplementation(async () => {
    api.list.mockResolvedValue([connected])
    return connected
  })
  api.tools.mockResolvedValue(connected)
  renderList()
  await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
  await user.click(await screen.findByRole('menuitem', { name: 'tools.mcp.operation.edit' }))
  const edit = await screen.findByRole('dialog', { name: 'tools.mcp.modal.editTitle' })
  await user.clear(within(edit).getByRole('textbox', { name: 'tools.mcp.modal.name' }))
  await user.type(
    within(edit).getByRole('textbox', { name: 'tools.mcp.modal.name' }),
    'Updated MCP',
  )
  await user.click(within(edit).getByRole('button', { name: 'tools.mcp.modal.save' }))
  await waitFor(() =>
    expect(api.update).toHaveBeenCalledWith({
      body: expect.objectContaining({
        provider_id: provider.id,
        name: 'Updated MCP',
        server_url: '[__HIDDEN__]',
        server_identifier: 'weather',
      }),
    }),
  )
  await waitFor(() =>
    expect(
      screen.queryByRole('dialog', { name: 'tools.mcp.modal.editTitle' }),
    ).not.toBeInTheDocument(),
  )
  const detail = await screen.findByRole('dialog')
  expect(within(detail).getByText('Updated MCP')).toBeInTheDocument()
  await waitFor(() =>
    expect(api.authorize).toHaveBeenCalledExactlyOnceWith({ body: { provider_id: provider.id } }),
  )
  await waitFor(() =>
    expect(api.updateTools).toHaveBeenCalledWith({ params: { provider_id: provider.id } }),
  )
  expect(
    await within(detail).findByRole('button', { name: 'tools.auth.authorized' }),
  ).toBeInTheDocument()
  await user.click(within(detail).getByRole('button', { name: 'common.operation.close' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await user.click(screen.getByRole('button', { name: /Updated MCP/ }))
  expect(await screen.findByRole('dialog')).toBeInTheDocument()
  expect(api.authorize).toHaveBeenCalledTimes(1)
})

it.each(['cancel', 'escape'] as const)(
  'restores selected details when deletion is dismissed with %s',
  async (dismiss) => {
    const user = userEvent.setup()
    renderList()
    await user.click(screen.getByRole('button', { name: /Weather MCP/ }))
    const detail = await screen.findByRole('dialog')
    await user.click(within(detail).getByRole('button', { name: 'common.operation.more' }))
    await user.click(await screen.findByRole('menuitem', { name: 'tools.mcp.operation.remove' }))
    const confirm = await screen.findByRole('alertdialog', { name: 'tools.mcp.delete' })
    if (dismiss === 'cancel')
      await user.click(within(confirm).getByRole('button', { name: 'common.operation.cancel' }))
    else await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(within(await screen.findByRole('dialog')).getByText('Weather MCP')).toBeInTheDocument()
    expect(api.remove).not.toHaveBeenCalled()
  },
)

it('keeps a failed deletion available for retry and refreshes after success', async () => {
  const user = userEvent.setup()
  api.remove.mockResolvedValueOnce({ result: 'error' })
  api.list.mockResolvedValue([])
  renderList()
  await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
  await user.click(await screen.findByRole('menuitem', { name: 'tools.mcp.operation.remove' }))
  const confirm = await screen.findByRole('alertdialog', { name: 'tools.mcp.delete' })
  await user.click(within(confirm).getByRole('button', { name: 'common.operation.confirm' }))
  await waitFor(() => expect(api.remove).toHaveBeenCalledTimes(1))
  expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  expect(api.list).not.toHaveBeenCalled()
  await user.click(within(confirm).getByRole('button', { name: 'common.operation.confirm' }))
  await waitFor(() => expect(api.remove).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  expect(screen.queryByRole('button', { name: /Weather MCP/ })).not.toBeInTheDocument()
})
