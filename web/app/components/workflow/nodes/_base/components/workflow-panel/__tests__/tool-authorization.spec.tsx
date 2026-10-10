import type { ReactNode } from 'react'
import type { ReactFlowState } from 'reactflow'
import type { ToolNodeType } from '@/app/components/workflow/nodes/tool/types'
import type { Edge, Node } from '@/app/components/workflow/types'
import { TooltipProvider } from '@langgenius/dify-ui/tooltip'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useStoreApi } from 'reactflow'
import { CollectionType } from '@/app/components/tools/types'
import { createEdge, createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum } from '@/app/components/workflow/types'
import ToolAuthorization from '../tool-authorization'

vi.mock('@/app/components/plugins/plugin-auth/hooks/use-plugin-auth', () => ({
  usePluginAuth: () => ({
    isLoading: false,
    isAuthorized: true,
    canOAuth: false,
    canApiKey: true,
    credentials: [],
  }),
}))

vi.mock('@/app/components/plugins/plugin-auth/workspace-auth', () => ({
  default: () => <div>Workspace connection picker</div>,
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

const connect = (source: string, target: string) => createEdge({ source, target })

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
}: { nodes?: Node[]; edges?: Edge[]; actions?: ReactNode } = {}) => {
  const content = (nodeId = 'node-1', provider = 'provider-a', providerId = 'provider-id-a') => (
    <TooltipProvider delay={0} closeDelay={0}>
      <section aria-label="Current node authorization">
        <ToolAuthorization
          key={nodeId}
          nodeId={nodeId}
          providerId={providerId}
          pluginPayload={{ category: 'tool', provider }}
          showAuthorizationTabs
        />
      </section>
      {actions}
    </TooltipProvider>
  )
  return { content, ...renderWorkflowFlowComponent(content(), { nodes, edges }) }
}

const seedReuseReference = (
  store: ReturnType<typeof setup>['store'],
  nodeId: string,
  sourceId: string,
  { provider = 'provider-a', providerId = 'provider-id-a' } = {},
) => {
  store.getState().setNodeAuthorizationTab(nodeId, provider, providerId, 'reuse-from-node')
  store.getState().setNodeReuseFromNode(nodeId, provider, providerId, {
    id: sourceId,
    title: sourceId,
  })
}

describe('Workflow tool authorization bridge', () => {
  it('preserves separate node drafts through tab changes and node panel remounts', async () => {
    const user = userEvent.setup()
    const { store, content, rerender } = setup()
    await user.click(screen.getByRole('tab', { name: appUserTab }))
    await user.type(screen.getByRole('textbox', { name: descriptionLabel }), 'Connect first node')
    await user.click(screen.getByRole('tab', { name: workspaceTab }))
    await user.click(screen.getByRole('tab', { name: appUserTab }))
    expect(screen.getByRole('textbox', { name: descriptionLabel })).toHaveValue(
      'Connect first node',
    )

    rerender(content('node-2'))
    expect(screen.getByRole('tab', { name: workspaceTab })).toHaveAttribute('aria-selected', 'true')
    await user.click(screen.getByRole('tab', { name: appUserTab }))
    expect(screen.getByRole('textbox', { name: descriptionLabel })).toHaveValue('')
    await user.type(screen.getByRole('textbox', { name: descriptionLabel }), 'Connect second node')

    rerender(content('node-1'))
    expect(screen.getByRole('tab', { name: appUserTab })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('textbox', { name: descriptionLabel })).toHaveValue(
      'Connect first node',
    )
    expect(store.getState().nodeAuthDrafts['node-2']?.draft?.description).toBe(
      'Connect second node',
    )
  })

  it.each([
    { provider: 'provider-b', providerId: 'provider-id-a' },
    { provider: 'provider-a', providerId: 'provider-id-b' },
  ])(
    'starts a fresh local configuration when identity changes to $provider / $providerId',
    async ({ provider, providerId }) => {
      const user = userEvent.setup()
      const { content, rerender } = setup()
      await user.click(screen.getByRole('tab', { name: appUserTab }))
      await user.type(screen.getByRole('textbox', { name: descriptionLabel }), 'Provider A only')

      rerender(content('node-1', provider, providerId))

      expect(screen.getByRole('tab', { name: workspaceTab })).toHaveAttribute(
        'aria-selected',
        'true',
      )
      await user.click(screen.getByRole('tab', { name: appUserTab }))
      expect(screen.getByRole('textbox', { name: descriptionLabel })).toHaveValue('')
      expect(screen.getByRole('checkbox', { name: 'plugin.auth.connection.apiKey' })).toBeChecked()
    },
  )

  it('updates errors while editing and revalidates when returning to App user Auth', async () => {
    const user = userEvent.setup()
    const { store } = setup()
    await user.click(screen.getByRole('tab', { name: appUserTab }))
    const description = screen.getByRole('textbox', { name: descriptionLabel })
    expect(description).toHaveAttribute('aria-invalid', 'true')
    expect(store.getState().nodeAuthDrafts['node-1']?.errors?.description).toBe(true)

    await user.type(description, 'Connect app users')
    expect(description).not.toHaveAttribute('aria-invalid', 'true')
    expect(store.getState().nodeAuthDrafts['node-1']?.errors?.description).toBe(false)
    await user.clear(description)
    expect(description).toHaveAttribute('aria-invalid', 'true')
    expect(store.getState().nodeAuthDrafts['node-1']?.errors?.description).toBe(true)

    const apiKey = screen.getByRole('checkbox', { name: 'plugin.auth.connection.apiKey' })
    await user.click(apiKey)
    expect(apiKey).toHaveAttribute('aria-invalid', 'true')
    expect(store.getState().nodeAuthDrafts['node-1']?.errors?.methods).toBe(true)
    await user.click(apiKey)
    expect(apiKey).not.toHaveAttribute('aria-invalid', 'true')
    expect(store.getState().nodeAuthDrafts['node-1']?.errors?.methods).toBe(false)

    await user.click(screen.getByRole('tab', { name: workspaceTab }))
    expect(store.getState().nodeAuthDrafts['node-1']?.errors).toBeUndefined()
    await user.click(screen.getByRole('tab', { name: appUserTab }))
    expect(screen.getByRole('textbox', { name: descriptionLabel })).toHaveValue('')
    expect(screen.getByRole('textbox', { name: descriptionLabel })).toHaveAttribute(
      'aria-invalid',
      'true',
    )
  })

  it('offers every other node with the same provider type and ID, regardless of tool, plugin or graph edges', async () => {
    const user = userEvent.setup()
    const upstream = [
      toolNode('workspace-source', 'Workspace source'),
      toolNode('app-user-source', 'App user source'),
      toolNode('legacy-source', 'Legacy source', { plugin_id: undefined }),
      toolNode('reuse-source', 'Chained source'),
      toolNode('other-provider', 'Other provider', { provider_id: 'provider-b' }),
      toolNode('other-type', 'Other provider type', { provider_type: CollectionType.custom }),
      toolNode('other-tool', 'Other tool', { tool_name: 'other-tool' }),
      toolNode('other-plugin', 'Other plugin', { plugin_id: 'plugin-b' }),
      createNode({ id: 'code-source', type: 'default', data: { title: 'Code source' } }),
    ]
    const { store } = setup({
      nodes: [
        ...upstream,
        toolNode('node-1'),
        toolNode('downstream', 'Downstream source'),
        toolNode('unconnected', 'Disconnected source'),
      ],
      edges: [
        ...upstream.map((node) => connect(node.id, 'node-1')),
        connect('node-1', 'downstream'),
      ],
    })
    act(() => {
      store
        .getState()
        .setNodeAuthorizationTab('app-user-source', 'provider-a', 'provider-id-a', 'app-user-auth')
      store
        .getState()
        .setNodeAuthorizationTab(
          'workspace-source',
          'old-provider',
          'provider-id-a',
          'app-user-auth',
        )
      store
        .getState()
        .setNodeAuthorizationTab('reuse-source', 'provider-a', 'provider-id-a', 'reuse-from-node')
    })

    await user.click(screen.getByRole('tab', { name: reuseTab }))
    await user.click(screen.getByRole('combobox', { name: selectNodeLabel }))
    const listbox = await screen.findByRole('listbox')
    expect(within(listbox).getAllByRole('option')).toHaveLength(8)
    expect(
      within(screen.getByRole('option', { name: /^Workspace source/ })).getByText(
        'plugin.auth.reuse.workspace',
      ),
    ).toBeVisible()
    expect(
      within(screen.getByRole('option', { name: /^App user source/ })).getByText(
        'plugin.auth.reuse.appUser',
      ),
    ).toBeVisible()
    expect(screen.getByRole('option', { name: /^Legacy source/ })).toBeVisible()
    expect(
      within(screen.getByRole('option', { name: /^Chained source/ })).getByText(
        'plugin.auth.reuseFromNode',
      ),
    ).toBeVisible()
    expect(screen.getByRole('option', { name: /^Downstream source/ })).toBeVisible()
    expect(screen.getByRole('option', { name: /^Disconnected source/ })).toBeVisible()
    expect(screen.getByRole('option', { name: /^Other tool/ })).toBeVisible()
    expect(screen.getByRole('option', { name: /^Other plugin/ })).toBeVisible()
    expect(screen.queryByRole('option', { name: /^Other provider/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /^Code source/ })).not.toBeInTheDocument()
    expect(
      within(listbox).queryByText('plugin.auth.reuse.connectionExpired'),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('option', { name: /^Downstream source/ }))
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    expect(screen.getByRole('combobox', { name: selectNodeLabel })).toHaveTextContent(
      'Downstream source',
    )
    await user.click(screen.getByRole('combobox', { name: selectNodeLabel }))
    await user.click(await screen.findByRole('option', { name: /^Disconnected source/ }))
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    expect(store.getState().nodeAuthDrafts['node-1']?.reuseFromNode?.source.id).toBe('unconnected')

    await user.click(screen.getByRole('combobox', { name: selectNodeLabel }))
    await user.click(await screen.findByRole('option', { name: /^Other tool/ }))
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    expect(screen.getByRole('combobox', { name: selectNodeLabel })).toHaveTextContent('Other tool')
    expect(store.getState().nodeAuthDrafts['node-1']?.reuseFromNode?.source.id).toBe('other-tool')

    await user.click(screen.getByRole('combobox', { name: selectNodeLabel }))
    await user.click(await screen.findByRole('option', { name: /^Other plugin/ }))
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    expect(screen.getByRole('combobox', { name: selectNodeLabel })).toHaveTextContent(
      'Other plugin',
    )
    expect(store.getState().nodeAuthDrafts['node-1']?.reuseFromNode?.source.id).toBe('other-plugin')
  })

  it('includes matching tools across containers regardless of graph edges', async () => {
    const user = userEvent.setup()
    const parent = createNode({
      id: 'iteration',
      type: 'default',
      data: { type: BlockEnum.Iteration },
    })
    const inside = { ...toolNode('inside-source', 'Earlier inside tool'), parentId: parent.id }
    const later = { ...toolNode('later-source', 'Later inside tool'), parentId: parent.id }
    const current = { ...toolNode('node-1'), parentId: parent.id }
    setup({
      nodes: [
        toolNode('outer-source', 'Outer tool'),
        parent,
        inside,
        current,
        later,
        toolNode('unconnected', 'Disconnected outer tool'),
      ],
      edges: [
        connect('outer-source', parent.id),
        connect(inside.id, current.id),
        connect(current.id, later.id),
      ],
    })

    await user.click(screen.getByRole('tab', { name: reuseTab }))
    await user.click(screen.getByRole('combobox', { name: selectNodeLabel }))
    const listbox = await screen.findByRole('listbox')
    expect(within(listbox).getAllByRole('option')).toHaveLength(4)
    expect(screen.getByRole('option', { name: /^Outer tool/ })).toBeVisible()
    expect(screen.getByRole('option', { name: /^Earlier inside tool/ })).toBeVisible()
    expect(screen.getByRole('option', { name: /^Later inside tool/ })).toBeVisible()
    expect(screen.getByRole('option', { name: /^Disconnected outer tool/ })).toBeVisible()
  })

  it('preserves per-node selections across panels and keeps a renamed source snapshot after deletion', async () => {
    const user = userEvent.setup()
    const first = toolNode('first-source', 'First source')
    const second = toolNode('second-source', 'Second source')
    const { store, content, rerender } = setup({
      nodes: [first, second, toolNode('node-1'), toolNode('node-2')],
      edges: ['node-1', 'node-2'].flatMap((target) => [
        connect(first.id, target),
        connect(second.id, target),
      ]),
      actions: (
        <>
          <GraphAction
            label="Rename first source"
            update={({ setNodes, getNodes }) =>
              setNodes(
                getNodes().map((node) =>
                  node.id === first.id
                    ? { ...node, data: { ...node.data, title: 'Renamed source' } }
                    : node,
                ),
              )
            }
          />
          <GraphAction
            label="Delete first source"
            update={({ setNodes, getNodes }) =>
              setNodes(getNodes().filter((node) => node.id !== first.id))
            }
          />
        </>
      ),
    })
    const choose = async (name: RegExp) => {
      await user.click(screen.getByRole('combobox', { name: selectNodeLabel }))
      await user.click(await screen.findByRole('option', { name }))
      await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    }

    await user.click(screen.getByRole('tab', { name: reuseTab }))
    await choose(/^First source/)
    for (const tab of [workspaceTab, appUserTab]) {
      await user.click(screen.getByRole('tab', { name: tab }))
      await user.click(screen.getByRole('tab', { name: reuseTab }))
      expect(screen.getByRole('combobox', { name: selectNodeLabel })).toHaveTextContent(
        'First source',
      )
    }

    rerender(content('node-2'))
    await user.click(screen.getByRole('tab', { name: reuseTab }))
    expect(screen.getByRole('combobox', { name: selectNodeLabel })).toHaveTextContent(
      selectNodeLabel,
    )
    await choose(/^Second source/)
    rerender(content())
    expect(screen.getByRole('combobox', { name: selectNodeLabel })).toHaveTextContent(
      'First source',
    )

    await user.click(screen.getByRole('button', { name: 'Rename first source' }))
    expect(screen.getByRole('combobox', { name: selectNodeLabel })).toHaveTextContent(
      'Renamed source',
    )
    await waitFor(() =>
      expect(store.getState().nodeAuthDrafts['node-1']?.reuseFromNode?.source.title).toBe(
        'Renamed source',
      ),
    )
    await user.click(screen.getByRole('button', { name: 'Delete first source' }))
    expect(screen.getByRole('combobox', { name: selectNodeLabel })).toHaveTextContent(
      'Renamed source',
    )
    expect(screen.getByText('plugin.auth.reuse.removed')).toBeVisible()
    expect(screen.queryByRole('button', { name: locateLabel })).not.toBeInTheDocument()

    await choose(/^Second source/)
    expect(screen.queryByText('plugin.auth.reuse.removed')).not.toBeInTheDocument()
    expect(store.getState().nodeAuthDrafts['node-1']?.reuseFromNode).toMatchObject({
      source: { id: second.id },
    })
    expect(store.getState().nodeAuthDrafts['node-2']?.reuseFromNode?.source.id).toBe(second.id)
  })

  it.each([
    { mode: 'Workspace', tab: workspaceTab },
    { mode: 'App user', tab: appUserTab },
  ])('clears a preserved circular source when returning from $mode to Reuse', async ({ tab }) => {
    const user = userEvent.setup()
    const { store, content, rerender } = setup({
      nodes: [
        toolNode('node-1', 'Tool A', { tool_name: 'tool-a' }),
        toolNode('node-2', 'Tool B', { tool_name: 'tool-b' }),
        toolNode('safe', 'Independent source', { tool_name: 'tool-c' }),
      ],
    })
    const choose = async (name: RegExp) => {
      await user.click(screen.getByRole('combobox', { name: selectNodeLabel }))
      await user.click(await screen.findByRole('option', { name }))
      await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    }

    await user.click(screen.getByRole('tab', { name: reuseTab }))
    await choose(/^Tool B/)
    await user.click(screen.getByRole('tab', { name: tab }))

    rerender(content('node-2'))
    await user.click(screen.getByRole('tab', { name: reuseTab }))
    await choose(/^Tool A/)

    rerender(content('node-1'))
    await user.click(screen.getByRole('tab', { name: reuseTab }))

    const selection = screen.getByRole('combobox', { name: selectNodeLabel })
    expect(selection).toHaveTextContent(selectNodeLabel)
    expect(screen.queryByRole('button', { name: locateLabel })).not.toBeInTheDocument()
    expect(store.getState().nodeAuthDrafts['node-1']?.reuseFromNode).toBeUndefined()
    expect(store.getState().nodeAuthDrafts['node-2']?.reuseFromNode?.source.id).toBe('node-1')

    await user.click(selection)
    const circular = await screen.findByRole('option', { name: /^Tool B/ })
    expect(circular).toHaveAttribute('aria-disabled', 'true')
    expect(circular).toHaveAttribute('aria-selected', 'false')
    await user.click(circular)
    expect(selection).toHaveTextContent(selectNodeLabel)
    expect(store.getState().nodeAuthDrafts['node-1']?.reuseFromNode).toBeUndefined()

    const independent = screen.getByRole('option', { name: /^Independent source/ })
    expect(independent).not.toHaveAttribute('aria-disabled', 'true')
    await user.click(independent)
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    expect(selection).toHaveTextContent('Independent source')
    expect(store.getState().nodeAuthDrafts['node-1']?.reuseFromNode?.source.id).toBe('safe')

    rerender(content('node-2'))
    expect(screen.getByRole('combobox', { name: selectNodeLabel })).toHaveTextContent('Tool A')
    expect(store.getState().nodeAuthDrafts['node-2']?.reuseFromNode?.source.id).toBe('node-1')
  })

  it('keeps a selected source when its authorization mode or graph connections change', async () => {
    const user = userEvent.setup()
    const source = toolNode('source', 'Source tool')
    const edge = connect(source.id, 'node-1')
    const { store } = setup({
      nodes: [source, toolNode('node-1')],
      edges: [edge],
      actions: (
        <>
          <GraphAction label="Disconnect source" update={({ setEdges }) => setEdges([])} />
          <GraphAction label="Reconnect source" update={({ setEdges }) => setEdges([edge])} />
        </>
      ),
    })
    await user.click(screen.getByRole('tab', { name: reuseTab }))
    await user.click(screen.getByRole('combobox', { name: selectNodeLabel }))
    await user.click(await screen.findByRole('option', { name: /^Source tool/ }))
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())

    act(() =>
      store
        .getState()
        .setNodeAuthorizationTab(source.id, 'provider-a', 'provider-id-a', 'app-user-auth'),
    )
    expect(
      screen.getByText('plugin.auth.reuse.source:{"type":"plugin.auth.reuse.appUser"}'),
    ).toBeVisible()
    act(() =>
      store
        .getState()
        .setNodeAuthorizationTab(source.id, 'provider-a', 'provider-id-a', 'reuse-from-node'),
    )
    expect(
      screen.getByText('plugin.auth.reuse.source:{"type":"plugin.auth.reuseFromNode"}'),
    ).toBeVisible()
    expect(screen.queryByText('plugin.auth.reuse.removed')).not.toBeInTheDocument()
    act(() =>
      store
        .getState()
        .setNodeAuthorizationTab(source.id, 'provider-a', 'provider-id-a', 'workspace-auth'),
    )
    expect(screen.queryByText('plugin.auth.reuse.removed')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Disconnect source' }))
    expect(screen.queryByText('plugin.auth.reuse.removed')).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: selectNodeLabel })).toHaveTextContent('Source tool')
    expect(screen.getByRole('button', { name: locateLabel })).toBeEnabled()
    expect(store.getState().nodeAuthDrafts['node-1']?.reuseFromNode?.source.id).toBe(source.id)
    await user.click(screen.getByRole('button', { name: 'Reconnect source' }))
    expect(screen.queryByText('plugin.auth.reuse.removed')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: locateLabel })).toBeEnabled()
  })

  it.each([
    { scenario: 'direct cycle', links: [['source', 'node-1']] as const },
    {
      scenario: 'indirect cycle',
      links: [
        ['source', 'middle'],
        ['middle', 'node-1'],
      ] as const,
    },
    {
      scenario: 'pre-existing cycle',
      links: [
        ['source', 'middle'],
        ['middle', 'source'],
      ] as const,
    },
  ])(
    'keeps a $scenario across different tools visible but prevents selecting it',
    async ({ links }) => {
      const user = userEvent.setup()
      const { store } = setup({
        nodes: [
          toolNode('node-1'),
          toolNode('source', 'Circular source', {
            tool_name: 'second-tool',
            plugin_id: 'plugin-b',
          }),
          toolNode('middle', 'Middle source', { tool_name: 'third-tool', plugin_id: 'plugin-c' }),
          toolNode('safe', 'Independent source'),
        ],
      })
      act(() => {
        links.forEach(([nodeId, sourceId]) => seedReuseReference(store, nodeId, sourceId))
      })

      await user.click(screen.getByRole('tab', { name: reuseTab }))
      await user.click(screen.getByRole('combobox', { name: selectNodeLabel }))
      const circular = await screen.findByRole('option', { name: /^Circular source/ })
      expect(circular).toBeVisible()
      expect(circular).toHaveAttribute('aria-disabled', 'true')
      expect(within(circular).getByText('plugin.auth.reuseFromNode')).toBeVisible()

      await user.click(circular)
      expect(screen.getByRole('listbox')).toBeVisible()
      expect(store.getState().nodeAuthDrafts['node-1']?.reuseFromNode).toBeUndefined()
      expect(screen.getByRole('combobox', { name: selectNodeLabel })).toHaveTextContent(
        selectNodeLabel,
      )

      const independent = screen.getByRole('option', { name: /^Independent source/ })
      expect(independent).not.toHaveAttribute('aria-disabled', 'true')
      await user.click(independent)
      await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
      expect(screen.getByRole('combobox', { name: selectNodeLabel })).toHaveTextContent(
        'Independent source',
      )
      expect(store.getState().nodeAuthDrafts['node-1']?.reuseFromNode?.source.id).toBe('safe')
    },
  )

  it('recomputes disabled candidates when another open panel changes its mode or Reuse reference', async () => {
    const user = userEvent.setup()
    setup({
      nodes: [
        toolNode('node-1', 'Current tool'),
        toolNode('source', 'Source tool', { tool_name: 'second-tool' }),
        toolNode('safe', 'Independent tool', { tool_name: 'third-tool' }),
      ],
      actions: (
        <section aria-label="Source node authorization">
          <ToolAuthorization
            nodeId="source"
            providerId="provider-id-a"
            pluginPayload={{ category: 'tool', provider: 'provider-a' }}
            showAuthorizationTabs
          />
        </section>
      ),
    })
    const currentPanel = within(screen.getByRole('region', { name: 'Current node authorization' }))
    const sourcePanel = within(screen.getByRole('region', { name: 'Source node authorization' }))
    const openCurrentOptions = () =>
      user.click(currentPanel.getByRole('combobox', { name: selectNodeLabel }))
    const closeOptions = async () => {
      await user.keyboard('{Escape}')
      await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    }
    const chooseSourceReference = async (name: RegExp) => {
      await user.click(sourcePanel.getByRole('combobox', { name: selectNodeLabel }))
      await user.click(await screen.findByRole('option', { name }))
      await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    }

    await user.click(currentPanel.getByRole('tab', { name: reuseTab }))
    await openCurrentOptions()
    expect(await screen.findByRole('option', { name: /^Source tool/ })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await closeOptions()

    await user.click(sourcePanel.getByRole('tab', { name: reuseTab }))
    await chooseSourceReference(/^Current tool/)
    await openCurrentOptions()
    expect(await screen.findByRole('option', { name: /^Source tool/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await closeOptions()

    await user.click(sourcePanel.getByRole('tab', { name: workspaceTab }))
    await openCurrentOptions()
    const workspaceSource = await screen.findByRole('option', { name: /^Source tool/ })
    expect(workspaceSource).not.toHaveAttribute('aria-disabled', 'true')
    expect(within(workspaceSource).getByText('plugin.auth.reuse.workspace')).toBeVisible()
    await closeOptions()

    await user.click(sourcePanel.getByRole('tab', { name: reuseTab }))
    await openCurrentOptions()
    expect(await screen.findByRole('option', { name: /^Source tool/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await closeOptions()

    await chooseSourceReference(/^Independent tool/)
    await openCurrentOptions()
    const reusableSource = await screen.findByRole('option', { name: /^Source tool/ })
    expect(reusableSource).not.toHaveAttribute('aria-disabled', 'true')
    expect(within(reusableSource).getByText('plugin.auth.reuseFromNode')).toBeVisible()
    await user.click(reusableSource)
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    expect(
      currentPanel.getByText('plugin.auth.reuse.source:{"type":"plugin.auth.reuseFromNode"}'),
    ).toBeVisible()
  })

  it.each([
    { scenario: 'inactive Workspace mode', mode: 'workspace-auth' as const },
    { scenario: 'inactive App user mode', mode: 'app-user-auth' as const },
    { scenario: 'stale provider', provider: 'old-provider' },
    { scenario: 'stale provider ID', providerId: 'old-provider-id' },
  ])('ignores a nested Reuse reference with $scenario', async ({ mode, ...identity }) => {
    const user = userEvent.setup()
    const { store } = setup({
      nodes: [
        toolNode('node-1'),
        toolNode('source', 'Reusable source', { tool_name: 'second-tool' }),
        toolNode('middle', 'Intermediate source', { tool_name: 'third-tool' }),
      ],
    })
    act(() => {
      seedReuseReference(store, 'source', 'middle')
      seedReuseReference(store, 'middle', 'node-1', identity)
      if (mode)
        store.getState().setNodeAuthorizationTab('middle', 'provider-a', 'provider-id-a', mode)
    })

    await user.click(screen.getByRole('tab', { name: reuseTab }))
    await user.click(screen.getByRole('combobox', { name: selectNodeLabel }))
    const source = await screen.findByRole('option', { name: /^Reusable source/ })
    expect(source).not.toHaveAttribute('aria-disabled', 'true')
    expect(within(source).getByText('plugin.auth.reuseFromNode')).toBeVisible()
    await user.click(source)
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    expect(screen.getByRole('combobox', { name: selectNodeLabel })).toHaveTextContent(
      'Reusable source',
    )
    expect(store.getState().nodeAuthDrafts['node-1']?.reuseFromNode?.source.id).toBe('source')
  })

  it('preserves its source and continues checking cycles after changing tools within the same provider', async () => {
    const user = userEvent.setup()
    const { store } = setup({
      nodes: [
        toolNode('source', 'Original tool source', { tool_name: 'source-tool' }),
        toolNode('circular', 'Circular source', { tool_name: 'another-tool' }),
        toolNode('node-1'),
      ],
      edges: [connect('source', 'node-1')],
      actions: (
        <GraphAction
          label="Change current tool"
          update={({ setNodes, getNodes }) =>
            setNodes(
              getNodes().map((node) =>
                node.id === 'node-1'
                  ? { ...node, data: { ...node.data, tool_name: 'different-tool' } }
                  : node,
              ),
            )
          }
        />
      ),
    })
    act(() => seedReuseReference(store, 'circular', 'node-1'))
    await user.click(screen.getByRole('tab', { name: reuseTab }))
    await user.click(screen.getByRole('combobox', { name: selectNodeLabel }))
    await user.click(await screen.findByRole('option', { name: /^Original tool source/ }))
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Change current tool' }))

    const select = screen.getByRole('combobox', { name: selectNodeLabel })
    expect(select).toHaveTextContent('Original tool source')
    expect(select).toBeEnabled()
    expect(screen.queryByText('plugin.auth.reuse.removed')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: locateLabel })).toBeEnabled()
    expect(store.getState().nodeAuthDrafts['node-1']?.reuseFromNode?.source.id).toBe('source')

    await user.click(select)
    const circular = await screen.findByRole('option', { name: /^Circular source/ })
    expect(circular).toHaveAttribute('aria-disabled', 'true')
    await user.click(circular)
    expect(store.getState().nodeAuthDrafts['node-1']?.reuseFromNode?.source.id).toBe('source')
    expect(select).toHaveTextContent('Original tool source')
  })

  it('requests the existing select-and-focus navigation for the chosen source', async () => {
    const user = userEvent.setup()
    setup({
      nodes: [toolNode('source', 'Locate this source'), toolNode('node-1')],
      edges: [connect('source', 'node-1')],
    })
    await user.click(screen.getByRole('tab', { name: reuseTab }))
    await user.click(screen.getByRole('combobox', { name: selectNodeLabel }))
    await user.click(await screen.findByRole('option', { name: /^Locate this source/ }))
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
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
