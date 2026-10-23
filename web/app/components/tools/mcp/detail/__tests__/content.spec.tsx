import type { ComponentProps } from 'react'
import type { openOAuthPopup } from '@/hooks/use-oauth'
import type { consoleClient } from '@/service/console'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createToolProviderFixture } from '@/test/console/tool-provider-fixture'
import { createDeferred } from '@/test/deferred'
import { createMcpProviderFixture } from '@/test/fixtures/mcp'
import MCPDetailContent from '../content'

const getTools =
  vi.fn<typeof consoleClient.workspaces.current.toolProvider.mcp.tools.byProviderId.get>()
const updateTools =
  vi.fn<typeof consoleClient.workspaces.current.toolProvider.mcp.update.byProviderId.get>()
const authorize = vi.fn<typeof consoleClient.workspaces.current.toolProvider.mcp.auth.post>()
const { openOAuth } = vi.hoisted(() => ({ openOAuth: vi.fn<typeof openOAuthPopup>() }))

// Keep the independently tested popup lifecycle outside this detail interaction.
vi.mock('@/hooks/use-oauth', () => ({ openOAuthPopup: openOAuth }))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.toolProvider.mcp.tools.byProviderId.get': (input) => getTools(input),
      'workspaces.current.toolProvider.mcp.update.byProviderId.get': (input) => updateTools(input),
      'workspaces.current.toolProvider.mcp.auth.post': (input) => authorize(input),
    }),
  }
})

const toolsResponse = (...names: string[]) =>
  createToolProviderFixture({
    id: 'mcp-1',
    type: 'mcp',
    tools: names.map((name) => ({
      name,
      author: 'MCP',
      label: { en_US: name },
      description: { en_US: `${name} description` },
      parameters: [],
    })),
  })
const providerToolsKey =
  consoleQuery.workspaces.current.toolProvider.mcp.tools.byProviderId.get.queryKey({
    input: { params: { provider_id: 'mcp-1' } },
  })
const mcpToolsKey = consoleQuery.workspaces.current.tools.mcp.get.queryKey()

const setup = ({
  props = {},
  canManage = true,
  tools = toolsResponse(),
}: {
  props?: Partial<ComponentProps<typeof MCPDetailContent>>
  canManage?: boolean
  tools?: ReturnType<typeof toolsResponse> | null
} = {}) => {
  const { wrapper, queryClient } = createConsoleQueryWrapper({
    workspacePermissionKeys: canManage ? ['mcp.manage'] : [],
  })
  if (tools) queryClient.setQueryData(providerToolsKey, tools)
  queryClient.setQueryData(mcpToolsKey, [])
  const onUpdate = vi.fn()
  const onFirstCreate = vi.fn()
  const onEdit = vi.fn()
  const onDelete = vi.fn()
  const onHide = vi.fn()
  const view = render(
    <MCPDetailContent
      detail={createMcpProviderFixture()}
      isTriggerAuthorize={false}
      onUpdate={onUpdate}
      onFirstCreate={onFirstCreate}
      onEdit={onEdit}
      onDelete={onDelete}
      onHide={onHide}
      {...props}
    />,
    { wrapper },
  )
  return {
    ...view,
    queryClient,
    onUpdate,
    onFirstCreate,
    onEdit,
    onDelete,
    onHide,
    user: userEvent.setup(),
  }
}
const button = (name: string) => screen.getByRole('button', { name })

beforeEach(() => {
  getTools.mockReset().mockResolvedValue(toolsResponse('refreshed-tool'))
  updateTools.mockReset().mockResolvedValue(toolsResponse('refreshed-tool'))
  authorize.mockReset().mockResolvedValue({ result: 'success' })
  openOAuth.mockReset().mockReturnValue(null)
})

afterEach(() => vi.unstubAllGlobals())

describe('MCP detail tools', () => {
  it('loads the server tools through the real query and renders their names and descriptions', async () => {
    const pending = createDeferred<ReturnType<typeof toolsResponse>>()
    getTools.mockReturnValueOnce(pending.promise)
    setup({ tools: null })
    expect(screen.getByText('tools.mcp.gettingTools')).toBeInTheDocument()
    await act(async () => pending.resolve(toolsResponse('search', 'fetch')))
    expect(await screen.findByRole('button', { name: 'search' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'fetch' })).toBeInTheDocument()
    expect(screen.getByText('search description')).toBeInTheDocument()
    expect(getTools).toHaveBeenCalledWith({ params: { provider_id: 'mcp-1' } })
    expect(screen.queryByText('tools.mcp.gettingTools')).not.toBeInTheDocument()
  })

  it('fetches tools from the authorized empty state', async () => {
    const { user, onUpdate } = setup()
    expect(screen.getByText('tools.mcp.toolsEmpty')).toBeInTheDocument()
    await user.click(button('tools.mcp.getTools'))
    expect(await screen.findByRole('button', { name: 'refreshed-tool' })).toBeInTheDocument()
    expect(updateTools).toHaveBeenCalledWith({ params: { provider_id: 'mcp-1' } })
    expect(onUpdate).toHaveBeenCalledOnce()
  })

  it('refreshes the list and invalidates the provider catalog after a confirmed update', async () => {
    const pending = createDeferred<Awaited<ReturnType<typeof updateTools>>>()
    updateTools.mockReturnValueOnce(pending.promise)
    const { user, onUpdate, queryClient } = setup({ tools: toolsResponse('old-tool') })
    await user.click(button('tools.mcp.update'))
    expect(updateTools).not.toHaveBeenCalled()
    await user.click(button('common.operation.confirm'))
    expect(await screen.findByText('tools.mcp.updateTools')).toBeInTheDocument()
    expect(onUpdate).not.toHaveBeenCalled()
    await act(async () => pending.resolve(toolsResponse('refreshed-tool')))
    expect(await screen.findByRole('button', { name: 'refreshed-tool' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'old-tool' })).not.toBeInTheDocument()
    expect(updateTools).toHaveBeenCalledWith({ params: { provider_id: 'mcp-1' } })
    expect(queryClient.getQueryState(mcpToolsKey)?.isInvalidated).toBe(true)
    expect(onUpdate).toHaveBeenCalledOnce()
  })

  it('keeps the existing tools when an update is cancelled', async () => {
    const { user } = setup({ tools: toolsResponse('old-tool') })
    await user.click(button('tools.mcp.update'))
    await user.click(button('common.operation.cancel'))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'old-tool' })).toBeInTheDocument()
    expect(updateTools).not.toHaveBeenCalled()
    expect(getTools).not.toHaveBeenCalled()
  })
})

describe('MCP authorization', () => {
  it.each([false, true])(
    'authorizes or reauthorizes and refreshes tools (previously authorized=%s)',
    async (authorized) => {
      const pending = createDeferred<Awaited<ReturnType<typeof authorize>>>()
      authorize.mockReturnValueOnce(pending.promise)
      const { user, onFirstCreate, onUpdate } = setup({
        props: { detail: createMcpProviderFixture({ is_team_authorization: authorized }) },
      })
      await user.click(button(authorized ? 'tools.auth.authorized' : 'tools.mcp.authorize'))
      expect(await screen.findByRole('button', { name: 'tools.mcp.authorizing' })).toBeDisabled()
      expect(authorize).toHaveBeenCalledWith({ body: { provider_id: 'mcp-1' } })
      expect(onFirstCreate).toHaveBeenCalledOnce()
      expect(updateTools).not.toHaveBeenCalled()
      await act(async () => pending.resolve({ result: 'success' }))
      await waitFor(() => expect(onUpdate).toHaveBeenCalledOnce())
      expect(updateTools).toHaveBeenCalledWith({ params: { provider_id: 'mcp-1' } })
      expect(
        screen.queryByRole('button', { name: 'tools.mcp.authorizing' }),
      ).not.toBeInTheDocument()
    },
  )

  it('starts initial authorization when requested by the parent', async () => {
    const { onFirstCreate, onUpdate } = setup({
      props: {
        detail: createMcpProviderFixture({ is_team_authorization: false }),
        isTriggerAuthorize: true,
      },
    })
    await waitFor(() => expect(onUpdate).toHaveBeenCalledOnce())
    expect(authorize).toHaveBeenCalledWith({ body: { provider_id: 'mcp-1' } })
    expect(onFirstCreate).toHaveBeenCalledOnce()
  })

  it('refreshes tools after the OAuth popup completes', async () => {
    authorize.mockResolvedValueOnce({ authorization_url: 'https://oauth.example.com' })
    const { user, onUpdate } = setup({
      props: { detail: createMcpProviderFixture({ is_team_authorization: false }) },
    })
    await user.click(button('tools.mcp.authorize'))
    await waitFor(() =>
      expect(openOAuth).toHaveBeenCalledWith('https://oauth.example.com', expect.any(Function)),
    )
    expect(updateTools).not.toHaveBeenCalled()
    const [, complete] = openOAuth.mock.calls[0]!
    await act(async () => complete())
    await waitFor(() => expect(onUpdate).toHaveBeenCalledOnce())
    expect(updateTools).toHaveBeenCalledWith({ params: { provider_id: 'mcp-1' } })
  })

  it.each([false, true])(
    'keeps management and authorization read-only without permission (authorized=%s)',
    async (authorized) => {
      const { user } = setup({
        canManage: false,
        props: { detail: createMcpProviderFixture({ is_team_authorization: authorized }) },
      })
      expect(screen.getByText('Existing Server')).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'common.operation.more' }),
      ).not.toBeInTheDocument()
      const authorizeButton = button(authorized ? 'tools.auth.authorized' : 'tools.mcp.authorize')
      expect(authorizeButton).toBeDisabled()
      await user.click(authorizeButton)
      expect(authorize).not.toHaveBeenCalled()
    },
  )
})

describe('MCP detail actions', () => {
  it.each(['edit', 'remove'] as const)('requests %s for the current provider', async (action) => {
    const { user, onEdit, onDelete } = setup()
    await user.click(button('common.operation.more'))
    await user.click(screen.getByRole('menuitem', { name: `tools.mcp.operation.${action}` }))
    expect(action === 'edit' ? onEdit : onDelete).toHaveBeenCalledWith('mcp-1')
  })

  it('closes the provider detail', async () => {
    const { user, onHide } = setup()
    await user.click(button('common.operation.close'))
    expect(onHide).toHaveBeenCalledOnce()
  })

  it('copies the provider identifier', async () => {
    vi.stubGlobal('isSecureContext', true)
    const { user } = setup()
    await user.click(button('existing-server tools.mcp.identifier'))
    expect(await navigator.clipboard.readText()).toBe('existing-server')
  })
})
