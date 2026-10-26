import type { ReactNode } from 'react'
import type { ReactFlowState } from 'reactflow'
import type { Credential } from '@/app/components/plugins/plugin-auth/types'
import type { ToolNodeType } from '@/app/components/workflow/nodes/tool/types'
import type { Edge, Node } from '@/app/components/workflow/types'
import { TooltipProvider } from '@langgenius/dify-ui/tooltip'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { useStoreApi } from 'reactflow'
import { CollectionType } from '@/app/components/tools/types'
import { createEdge, createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum } from '@/app/components/workflow/types'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import ToolAuthorization from '../tool-authorization'

const mocks = vi.hoisted(() => ({
  canOAuth: false,
  isLoading: false,
  credentials: [] as Credential[],
  consoleCall: vi.fn(),
  syncDraft: vi.fn(),
  workspaceSelection: vi.fn(),
}))

vi.mock('@/app/components/plugins/plugin-auth/hooks/use-plugin-auth', () => ({
  usePluginAuth: () => ({
    isLoading: mocks.isLoading,
    isAuthorized: true,
    canOAuth: mocks.canOAuth,
    canApiKey: true,
    credentials: mocks.credentials,
    invalidPluginCredentialInfo: vi.fn(),
  }),
}))

vi.mock('@/service/console/browser', () => ({
  consoleBrowserLink: { call: (...args: unknown[]) => mocks.consoleCall(...args) },
}))

vi.mock('@/app/components/workflow/hooks/use-nodes-sync-draft', () => ({
  useNodesSyncDraft: () => ({ handleSyncWorkflowDraft: mocks.syncDraft }),
}))

const descriptionLabel = 'plugin.auth.appUser.connectionDescription'
const appUserTab = 'plugin.auth.appUserAuth'
const workspaceTab = 'plugin.auth.workspaceAuth'
const reuseTab = 'plugin.auth.reuseFromNode'
const selectNodeLabel = 'plugin.auth.reuse.selectNode'
const locateLabel = 'plugin.auth.reuse.locateSource'

const toolNode = (id: string, title = id, data: Partial<ToolNodeType> = {}) =>
  createNode({
    id,
    type: 'default',
    data: {
      type: BlockEnum.Tool,
      title,
      provider_id: 'provider-id-a',
      provider_name: 'provider-a',
      provider_type: CollectionType.builtIn,
      plugin_id: 'plugin-a',
      tool_name: 'same-tool',
      tool_label: 'Same tool',
      tool_parameters: {},
      tool_configurations: {},
      ...data,
    },
  })

const GraphProbe = ({ onReady }: { onReady: (graph: ReactFlowState) => void }) => {
  const graph = useStoreApi()
  useEffect(() => onReady(graph.getState()), [graph, onReady])
  return null
}

const GraphAction = ({
  label,
  update,
}: {
  label: string
  update: (graph: ReactFlowState) => void
}) => {
  const graph = useStoreApi()
  return (
    <button type="button" onClick={() => update(graph.getState())}>
      {label}
    </button>
  )
}

const setup = ({
  nodes = [toolNode('node-1'), toolNode('node-2')],
  edges = [],
  actions,
  readOnly = false,
}: { nodes?: Node[]; edges?: Edge[]; actions?: ReactNode; readOnly?: boolean } = {}) => {
  const { queryClient, wrapper: ConsoleQueryWrapper } = createConsoleQueryWrapper({
    workspacePermissionKeys: ['credential.use', 'credential.create', 'credential.manage'],
  })
  const { wrapper: UrlState } = createNuqsTestWrapper()
  queryClient.setQueryData(
    consoleQuery.workspaces.current.toolProvider.builtin.byProvider.credential.schema.byCredentialType.get.queryKey(
      { input: { params: { provider: 'provider-a', credential_type: 'api-key' } } },
    ),
    [
      {
        name: 'api_key',
        label: { en_US: 'API Key' },
        type: 'secret-input',
        required: true,
        multiple: false,
      },
    ],
  )
  let graph: ReactFlowState
  const onReady = (state: ReactFlowState) => {
    graph = state
  }
  const content = (nodeId = 'node-1') => (
    <ConsoleQueryWrapper>
      <UrlState>
        <TooltipProvider delay={0} closeDelay={0}>
          <GraphProbe onReady={onReady} />
          <section aria-label="Current node authorization">
            <ToolAuthorization
              key={nodeId}
              nodeId={nodeId}
              providerId="provider-id-a"
              pluginPayload={{ category: 'tool', provider: 'provider-a' }}
              nodeAuth={{
                providerName: 'Example provider',
                onAuthorizationItemClick: mocks.workspaceSelection,
              }}
              showAuthorizationTabs
            />
          </section>
          {actions}
        </TooltipProvider>
      </UrlState>
    </ConsoleQueryWrapper>
  )
  const rendered = renderWorkflowFlowComponent(content(), {
    nodes,
    edges,
    initialStoreState: { canvasReadOnly: readOnly },
  })
  return {
    content,
    ...rendered,
    getNodes: () => graph.getNodes() as Node[],
    getData: (nodeId = 'node-1') =>
      graph.getNodes().find((node) => node.id === nodeId)!.data as ToolNodeType,
  }
}

const chooseSource = async (user: ReturnType<typeof userEvent.setup>, name: RegExp) => {
  await user.click(screen.getByRole('combobox', { name: selectNodeLabel }))
  await user.click(await screen.findByRole('option', { name }))
  await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
}

describe('Workflow tool authorization persistence', () => {
  beforeEach(() => {
    mocks.canOAuth = false
    mocks.isLoading = false
    mocks.credentials = [
      {
        id: 'workspace-credential',
        name: 'Workspace connection',
        provider: 'provider-a',
        credential_type: 'api-key',
        is_default: true,
        credentials: { api_key: 'test-secret-must-not-be-saved' },
      },
      {
        id: 'test-credential',
        name: 'Testing connection',
        provider: 'provider-a',
        credential_type: 'api-key',
        is_default: false,
      },
    ]
    mocks.consoleCall.mockImplementation(async (path: string[]) => {
      if (path.includes('clientSchema')) {
        return {
          schema: [],
          is_oauth_custom_client_enabled: false,
          is_system_oauth_params_exists: true,
          client_params: {},
          redirect_uri: 'https://example.com/oauth/callback',
        }
      }
      throw new Error(`Unexpected console request: ${path.join('.')}`)
    })
  })

  it('saves App user edits and a real test credential ID through the graph draft boundary', async () => {
    const user = userEvent.setup()
    mocks.canOAuth = true
    const { getData } = setup({
      nodes: [toolNode('node-1', 'Current tool', { credential_id: 'workspace-credential' })],
    })
    await user.click(screen.getByRole('tab', { name: appUserTab }))
    await user.type(screen.getByRole('textbox', { name: descriptionLabel }), 'Connect app users')
    const testConnections = within(
      screen.getByRole('region', { name: 'plugin.auth.appUser.testConnection' }),
    )
    await user.click(
      testConnections.getByRole('button', { name: /^plugin.auth.appUser.testConnection/ }),
    )
    await user.click(await screen.findByRole('button', { name: /^Testing connection/ }))

    await waitFor(() =>
      expect(getData()).toMatchObject({
        credential_source: 'end_user',
        end_user_auth: {
          allowed_credential_types: ['api-key', 'oauth2'],
          purpose: 'Connect app users',
          oauth_client_type: 'default',
        },
        test_credential_id: 'test-credential',
      }),
    )
    expect(getData().credential_id).toBeUndefined()
    expect(getData().reuse_node_id).toBeUndefined()
    expect(mocks.syncDraft).toHaveBeenCalled()
    expect(mocks.workspaceSelection).not.toHaveBeenCalled()
    const persisted = JSON.stringify(getData())
    for (const uiOnlyValue of [
      'testConnection',
      'testCredentialId',
      'description',
      'errors',
      'test-secret-must-not-be-saved',
      'mock-test-',
    ])
      expect(persisted).not.toContain(uiOnlyValue)

    await user.click(screen.getByRole('checkbox', { name: 'plugin.auth.appUser.oauth' }))
    expect(getData().end_user_auth?.allowed_credential_types).toEqual(['api-key'])
    await user.clear(screen.getByRole('textbox', { name: descriptionLabel }))
    expect(getData().end_user_auth?.purpose).toBe('')
    expect(screen.getByRole('textbox', { name: descriptionLabel })).toHaveAttribute(
      'aria-invalid',
      'true',
    )
  })

  it('clears mutually exclusive persisted fields while preserving the inactive App user draft', async () => {
    const user = userEvent.setup()
    const { getData } = setup({
      nodes: [
        toolNode('source', 'Direct source'),
        toolNode('node-1', 'Current tool', {
          credential_source: 'end_user',
          end_user_auth: { allowed_credential_types: ['api-key'], purpose: 'Saved purpose' },
          test_credential_id: 'test-credential',
        }),
      ],
    })
    await user.click(screen.getByRole('tab', { name: workspaceTab }))
    expect(getData().credential_source).toBe('workspace')
    expect(getData().end_user_auth).toBeUndefined()
    expect(getData().test_credential_id).toBeUndefined()
    expect(getData().reuse_node_id).toBeUndefined()

    await user.click(screen.getByRole('tab', { name: appUserTab }))
    expect(screen.getByRole('textbox', { name: descriptionLabel })).toHaveValue('Saved purpose')
    expect(getData().end_user_auth?.purpose).toBe('Saved purpose')
    expect(getData().test_credential_id).toBe('test-credential')
    expect(getData().credential_id).toBeUndefined()

    await user.click(screen.getByRole('tab', { name: reuseTab }))
    await chooseSource(user, /^Direct source/)
    expect(getData().credential_source).toBe('reuse_node')
    expect(getData().reuse_node_id).toBe('source')
    expect(getData().credential_id).toBeUndefined()
    expect(getData().end_user_auth).toBeUndefined()
    expect(getData().test_credential_id).toBeUndefined()

    await user.click(screen.getByRole('tab', { name: workspaceTab }))
    expect(getData().reuse_node_id).toBeUndefined()
    await user.click(screen.getByRole('tab', { name: appUserTab }))
    expect(getData().end_user_auth?.purpose).toBe('Saved purpose')
    expect(getData().reuse_node_id).toBeUndefined()
  })

  it('saves Workspace connection changes and restores its selection after visiting App user Auth', async () => {
    const user = userEvent.setup()
    const { getData } = setup()
    await user.click(screen.getByRole('button', { name: /^Workspace connection/ }))
    await user.click(await screen.findByRole('button', { name: /^Testing connection/ }))
    expect(getData().credential_source).toBe('workspace')
    expect(getData().credential_id).toBe('test-credential')
    expect(mocks.syncDraft).toHaveBeenCalled()

    await user.click(screen.getByRole('tab', { name: appUserTab }))
    expect(getData().credential_id).toBeUndefined()
    await user.click(screen.getByRole('tab', { name: workspaceTab }))
    expect(getData().credential_id).toBe('test-credential')
    expect(screen.getByRole('button', { name: /^Testing connection/ })).toBeVisible()
    expect(getData().end_user_auth).toBeUndefined()
    expect(getData().test_credential_id).toBeUndefined()
  })

  it('restores saved App user configuration after a fresh workflow mount without UI cache', async () => {
    const user = userEvent.setup()
    const first = setup()
    await user.click(screen.getByRole('tab', { name: appUserTab }))
    await user.type(screen.getByRole('textbox', { name: descriptionLabel }), 'Saved across refresh')
    const savedNodes = JSON.parse(JSON.stringify(first.getNodes())) as Node[]
    first.unmount()
    mocks.syncDraft.mockClear()

    const refreshed = setup({ nodes: savedNodes })
    expect(screen.getByRole('tab', { name: appUserTab })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('textbox', { name: descriptionLabel })).toHaveValue(
      'Saved across refresh',
    )
    expect(refreshed.getData().end_user_auth?.purpose).toBe('Saved across refresh')
    expect(mocks.syncDraft).not.toHaveBeenCalled()
  })

  it('isolates edits when moving between node panels', async () => {
    const user = userEvent.setup()
    const { getData, content, rerender } = setup()
    await user.click(screen.getByRole('tab', { name: appUserTab }))
    await user.type(screen.getByRole('textbox', { name: descriptionLabel }), 'First node purpose')
    rerender(content('node-2'))
    expect(screen.getByRole('tab', { name: workspaceTab })).toHaveAttribute('aria-selected', 'true')
    await user.click(screen.getByRole('tab', { name: appUserTab }))
    expect(screen.getByRole('textbox', { name: descriptionLabel })).toHaveValue('')
    await user.type(screen.getByRole('textbox', { name: descriptionLabel }), 'Second node purpose')

    rerender(content('node-1'))
    expect(screen.getByRole('textbox', { name: descriptionLabel })).toHaveValue(
      'First node purpose',
    )
    expect(getData('node-1').end_user_auth?.purpose).toBe('First node purpose')
    expect(getData('node-2').end_user_auth?.purpose).toBe('Second node purpose')
  })

  it('restores a saved Reuse reference and saves direct authorization from other tools in the same provider', async () => {
    const user = userEvent.setup()
    const { getData } = setup({
      nodes: [
        toolNode('workspace', 'Workspace source'),
        toolNode('app-user', 'App user source', {
          tool_name: 'app-user-tool',
          credential_source: 'end_user',
          end_user_auth: { allowed_credential_types: ['api-key'], purpose: 'Source purpose' },
        }),
        toolNode('reuse', 'Chained source', {
          credential_source: 'reuse_node',
          reuse_node_id: 'workspace',
        }),
        toolNode('different-tool', 'Different tool', { tool_name: 'another-tool' }),
        toolNode('different-provider', 'Different provider', { provider_id: 'other-provider' }),
        toolNode('different-type', 'Different provider type', {
          provider_type: CollectionType.custom,
        }),
        toolNode('different-plugin', 'Different plugin', { plugin_id: 'other-plugin' }),
        toolNode('node-1', 'Current tool', {
          credential_source: 'reuse_node',
          reuse_node_id: 'workspace',
        }),
      ],
      edges: [createEdge({ source: 'node-1', target: 'workspace' })],
    })
    expect(screen.getByRole('tab', { name: reuseTab })).toHaveAttribute('aria-selected', 'true')
    const selection = screen.getByRole('combobox', { name: selectNodeLabel })
    expect(selection).toHaveTextContent('Workspace source')
    expect(mocks.syncDraft).not.toHaveBeenCalled()
    await user.click(selection)
    const listbox = await screen.findByRole('listbox')
    expect(within(listbox).getAllByRole('option')).toHaveLength(5)
    expect(screen.getByRole('option', { name: /^Different tool/ })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.queryByRole('option', { name: /^Different provider/ })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: /^Different plugin/ })).toBeVisible()
    const chained = screen.getByRole('option', { name: /^Chained source/ })
    expect(chained).toHaveAttribute('aria-disabled', 'true')
    await user.click(chained)
    expect(getData().reuse_node_id).toBe('workspace')
    await user.click(screen.getByRole('option', { name: /^App user source/ }))
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    expect(getData().reuse_node_id).toBe('app-user')
    await chooseSource(user, /^Different tool/)
    expect(getData().reuse_node_id).toBe('different-tool')
    expect(selection).toHaveTextContent('Different tool')
    expect(selection).not.toHaveAttribute('aria-invalid', 'true')
    expect(mocks.syncDraft).toHaveBeenCalled()
  })

  it('marks a source that changes to Reuse invalid while retaining its saved reference for repair', async () => {
    const user = userEvent.setup()
    const { getData } = setup({
      nodes: [
        toolNode('source', 'Source tool'),
        toolNode('safe', 'Independent source'),
        toolNode('node-1', 'Current tool', {
          credential_source: 'reuse_node',
          reuse_node_id: 'source',
        }),
      ],
      actions: (
        <GraphAction
          label="Change source authorization"
          update={({ getNodes, setNodes }) =>
            setNodes(
              getNodes().map((node) =>
                node.id === 'source'
                  ? {
                      ...node,
                      data: {
                        ...node.data,
                        credential_source: 'reuse_node',
                        reuse_node_id: 'safe',
                      },
                    }
                  : node,
              ),
            )
          }
        />
      ),
    })
    await user.click(screen.getByRole('button', { name: 'Change source authorization' }))
    const selection = screen.getByRole('combobox', { name: selectNodeLabel })
    expect(selection).toHaveAttribute('aria-invalid', 'true')
    expect(selection).toHaveTextContent('Source tool')
    expect(getData().reuse_node_id).toBe('source')
    expect(mocks.syncDraft).not.toHaveBeenCalled()
    await user.click(selection)
    expect(await screen.findByRole('option', { name: /^Source tool/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })

  it.each([workspaceTab, appUserTab])(
    'revalidates a cached Reuse source when returning from %s',
    async (tab) => {
      const user = userEvent.setup()
      const { getData } = setup({
        nodes: [
          toolNode('source', 'Source tool'),
          toolNode('node-1', 'Current tool', {
            credential_source: 'reuse_node',
            reuse_node_id: 'source',
          }),
        ],
        actions: (
          <GraphAction
            label="Change source provider"
            update={({ getNodes, setNodes }) =>
              setNodes(
                getNodes().map((node) =>
                  node.id === 'source'
                    ? { ...node, data: { ...node.data, provider_id: 'different-provider' } }
                    : node,
                ),
              )
            }
          />
        ),
      })
      await user.click(screen.getByRole('tab', { name: tab }))
      await user.click(screen.getByRole('button', { name: 'Change source provider' }))
      await user.click(screen.getByRole('tab', { name: reuseTab }))
      expect(getData().credential_source).toBe('reuse_node')
      expect(getData().reuse_node_id).toBeUndefined()
      expect(screen.getByRole('combobox', { name: selectNodeLabel })).toHaveTextContent(
        selectNodeLabel,
      )
    },
  )

  it('keeps a removed source visible for repair without serializing its UI snapshot', async () => {
    const user = userEvent.setup()
    const { getData } = setup({
      nodes: [
        toolNode('source', 'Source tool'),
        toolNode('node-1', 'Current tool', {
          credential_source: 'reuse_node',
          reuse_node_id: 'source',
        }),
      ],
      actions: (
        <GraphAction
          label="Delete source"
          update={({ getNodes, setNodes }) =>
            setNodes(getNodes().filter((node) => node.id !== 'source'))
          }
        />
      ),
    })
    await user.click(screen.getByRole('button', { name: 'Delete source' }))
    expect(screen.getByText('plugin.auth.reuse.removed')).toBeVisible()
    expect(screen.queryByRole('button', { name: locateLabel })).not.toBeInTheDocument()
    expect(getData().reuse_node_id).toBe('source')
    expect(JSON.stringify(getData())).not.toContain('Source tool')
  })

  it('does not overwrite saved configuration while provider capabilities are loading', async () => {
    mocks.isLoading = true
    const saved = {
      credential_source: 'end_user' as const,
      end_user_auth: { allowed_credential_types: ['api-key' as const], purpose: 'Already saved' },
      test_credential_id: 'test-credential',
    }
    const { getData, content, rerender } = setup({
      nodes: [toolNode('node-1', 'Current tool', saved)],
    })
    expect(getData()).toMatchObject(saved)
    expect(mocks.syncDraft).not.toHaveBeenCalled()
    mocks.isLoading = false
    rerender(content())
    expect(screen.getByRole('textbox', { name: descriptionLabel })).toHaveValue('Already saved')
    expect(getData()).toMatchObject(saved)
    expect(mocks.syncDraft).not.toHaveBeenCalled()
  })

  it('preserves the saved OAuth client type when workspace client metadata loads', async () => {
    mocks.canOAuth = true
    const saved = {
      credential_source: 'end_user' as const,
      end_user_auth: {
        allowed_credential_types: ['api-key' as const, 'oauth2' as const],
        purpose: 'Saved OAuth purpose',
        oauth_client_type: 'custom' as const,
      },
      test_credential_id: 'test-credential',
    }
    const { getData } = setup({ nodes: [toolNode('node-1', 'Current tool', saved)] })
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'plugin.auth.appUser.customClient' }),
      ).toBeEnabled(),
    )
    expect(getData()).toMatchObject(saved)
    expect(mocks.syncDraft).not.toHaveBeenCalled()
  })

  it('does not mutate the graph or synchronize draft changes in read-only mode', async () => {
    const user = userEvent.setup()
    const { getData, store } = setup({
      nodes: [
        toolNode('node-1', 'Current tool', {
          credential_source: 'end_user',
          end_user_auth: { allowed_credential_types: ['api-key'], purpose: 'Read-only purpose' },
          test_credential_id: 'test-credential',
        }),
      ],
    })
    const before = JSON.stringify(getData())
    act(() => store.setState({ canvasReadOnly: true }))
    mocks.syncDraft.mockClear()
    await user.type(screen.getByRole('textbox', { name: descriptionLabel }), ' changed')
    await user.click(screen.getByRole('tab', { name: workspaceTab }))
    expect(JSON.stringify(getData())).toBe(before)
    expect(mocks.syncDraft).not.toHaveBeenCalled()
  })

  it('requests canvas navigation for the selected saved source', async () => {
    const user = userEvent.setup()
    setup({
      nodes: [
        toolNode('source', 'Source tool'),
        toolNode('node-1', 'Current tool', {
          credential_source: 'reuse_node',
          reuse_node_id: 'source',
        }),
      ],
    })
    const onSelect = vi.fn()
    document.addEventListener('workflow:select-node', onSelect, { once: true })
    await user.click(screen.getByRole('button', { name: locateLabel }))
    expect(onSelect).toHaveBeenCalledOnce()
    expect((onSelect.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
      nodeId: 'source',
      focus: true,
    })
  })
})
