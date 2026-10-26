import type { ToolNodeType } from '../types'
import type { Node as WorkflowNode } from '@/app/components/workflow/types'
import { act, screen } from '@testing-library/react'
import { createAppUserAuthDraft } from '@/app/components/plugins/plugin-auth/app-user-auth/draft'
import { CollectionType } from '@/app/components/tools/types'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum } from '@/app/components/workflow/types'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createToolProviderFixture } from '@/test/console/tool-provider-fixture'
import { seedToolProviders } from '@/test/console/tool-providers'
import Node from '../node'

const createNodeData = (overrides: Partial<ToolNodeType> = {}): ToolNodeType => ({
  title: 'Google Search',
  desc: '',
  type: BlockEnum.Tool,
  provider_id: 'google_search',
  provider_type: CollectionType.builtIn,
  provider_name: 'Google Search',
  tool_name: 'google_search',
  tool_label: 'Google Search',
  tool_parameters: {},
  tool_configurations: {},
  ...overrides,
})

function renderTool(
  data: ToolNodeType,
  {
    authorized = true,
    nodes = [],
    providerIds = [data.provider_id],
  }: { authorized?: boolean; nodes?: WorkflowNode[]; providerIds?: string[] } = {},
) {
  const { queryClient } = createConsoleQueryWrapper()
  seedToolProviders(queryClient, {
    builtInTools: providerIds.map((id) =>
      createToolProviderFixture({
        id,
        name: id,
        allow_delete: true,
        is_team_authorization: authorized,
      }),
    ),
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  return renderWorkflowFlowComponent(<Node id="tool-node-1" data={data} />, { queryClient, nodes })
}

describe('ToolNode', () => {
  it('keeps configuration rows visible for a provider that requires authorization', () => {
    renderTool(
      createNodeData({
        tool_configurations: { region: { value: 'us' } },
      }),
      { authorized: false },
    )

    expect(screen.getByText('region')).toBeInTheDocument()
    expect(screen.getByText('us')).toBeInTheDocument()
    expect(screen.getByText('workflow.nodes.tool.authorizationRequired')).toBeInTheDocument()
  })

  it('renders multi-select configuration values', () => {
    renderTool(
      createNodeData({
        tool_configurations: { formats: { type: 'constant', value: ['png', 'svg'] } },
      }),
    )

    expect(screen.getByText('png, svg')).toBeInTheDocument()
  })

  it('updates App user errors on the canvas immediately as the draft changes', () => {
    const data = createNodeData()
    const { store } = renderTool(data, { authorized: false })
    expect(screen.getByText('workflow.nodes.tool.authorizationRequired')).toBeInTheDocument()
    const draft = createAppUserAuthDraft()
    act(() => {
      store
        .getState()
        .setNodeAppUserAuthDraft('tool-node-1', 'google_search', data.provider_id, draft)
      store
        .getState()
        .setNodeAuthorizationTab('tool-node-1', 'google_search', data.provider_id, 'app-user-auth')
    })
    expect(screen.getByText('plugin.auth.appUser.clientRequired')).toBeInTheDocument()
    expect(screen.getByText('plugin.auth.appUser.descriptionRequired')).toBeInTheDocument()
    expect(screen.queryByText('workflow.nodes.tool.authorizationRequired')).not.toBeInTheDocument()

    act(() => {
      store.getState().setNodeAppUserAuthDraft('tool-node-1', 'google_search', data.provider_id, {
        ...draft,
        oauthEnabled: false,
      })
    })
    expect(screen.queryByText('plugin.auth.appUser.clientRequired')).not.toBeInTheDocument()
    expect(screen.getByText('plugin.auth.appUser.descriptionRequired')).toBeInTheDocument()

    act(() => {
      store.getState().setNodeAppUserAuthDraft('tool-node-1', 'google_search', data.provider_id, {
        ...draft,
        oauthEnabled: false,
        description: 'Find repositories',
      })
    })
    expect(screen.queryByText('plugin.auth.appUser.descriptionRequired')).not.toBeInTheDocument()
    expect(screen.queryByText('workflow.nodes.tool.authorizationRequired')).not.toBeInTheDocument()

    act(() => {
      store.getState().setNodeAppUserAuthDraft('tool-node-1', 'google_search', data.provider_id, {
        ...draft,
        oauthEnabled: false,
        apiKeyEnabled: false,
        description: ' ',
      })
    })
    expect(screen.getByText('plugin.auth.appUser.selectMethod')).toBeInTheDocument()
    expect(screen.getByText('plugin.auth.appUser.descriptionRequired')).toBeInTheDocument()
    expect(screen.queryByText('plugin.auth.appUser.clientRequired')).not.toBeInTheDocument()

    act(() => {
      store
        .getState()
        .setNodeAuthorizationTab('tool-node-1', 'google_search', data.provider_id, 'workspace-auth')
    })
    expect(screen.getByText('workflow.nodes.tool.authorizationRequired')).toBeInTheDocument()
    expect(screen.queryByText('plugin.auth.appUser.selectMethod')).not.toBeInTheDocument()
    expect(screen.queryByText('plugin.auth.appUser.descriptionRequired')).not.toBeInTheDocument()
  })

  it('does not show errors for a different provider', () => {
    const data = createNodeData()
    const { store, rerender } = renderTool(data, {
      authorized: false,
      providerIds: [data.provider_id, 'github'],
    })
    act(() => {
      store
        .getState()
        .setNodeAppUserAuthDraft(
          'tool-node-1',
          'google_search',
          data.provider_id,
          createAppUserAuthDraft(),
        )
      store
        .getState()
        .setNodeAuthorizationTab('tool-node-1', 'google_search', data.provider_id, 'app-user-auth')
    })
    expect(screen.getByText('plugin.auth.appUser.descriptionRequired')).toBeInTheDocument()
    rerender(<Node id="tool-node-1" data={createNodeData({ provider_id: 'github' })} />)
    expect(screen.queryByText('plugin.auth.appUser.descriptionRequired')).not.toBeInTheDocument()
    expect(screen.getByText('workflow.nodes.tool.authorizationRequired')).toBeInTheDocument()
  })
})

it('inherits live App user errors through multiple Reuse sources and restores Workspace checks at the terminal', () => {
  const data = createNodeData()
  const source = createNode({
    id: 'auth-source',
    data: createNodeData({ tool_name: 'another-tool' }),
  })
  const middle = createNode({ id: 'middle', data: createNodeData() })
  const { store } = renderTool(data, {
    authorized: false,
    nodes: [source, middle],
  })
  act(() => {
    for (const [id, target] of [
      ['tool-node-1', middle],
      ['middle', source],
    ] as const) {
      store.getState().setNodeReuseFromNode(id, 'google_search', data.provider_id, {
        id: target.id,
        title: target.data.title,
      })
      store
        .getState()
        .setNodeAuthorizationTab(id, 'google_search', data.provider_id, 'reuse-from-node')
    }
    store.getState().setNodeAppUserAuthDraft('auth-source', 'google_search', data.provider_id, {
      ...createAppUserAuthDraft({ canOAuth: false, canApiKey: true }),
      description: '',
    })
    store
      .getState()
      .setNodeAuthorizationTab('auth-source', 'google_search', data.provider_id, 'app-user-auth')
  })
  expect(screen.getByText('plugin.auth.appUser.descriptionRequired')).toBeVisible()
  expect(screen.queryByText('workflow.nodes.tool.authorizationRequired')).not.toBeInTheDocument()
  act(() => {
    store.getState().setNodeAppUserAuthDraft('auth-source', 'google_search', data.provider_id, {
      ...createAppUserAuthDraft({ canOAuth: false, canApiKey: true }),
      description: 'Find repositories',
    })
  })
  expect(screen.queryByText('plugin.auth.appUser.descriptionRequired')).not.toBeInTheDocument()
  expect(screen.queryByText('workflow.nodes.tool.authorizationRequired')).not.toBeInTheDocument()
  act(() =>
    store
      .getState()
      .setNodeAuthorizationTab('auth-source', 'google_search', data.provider_id, 'workspace-auth'),
  )
  expect(screen.getByText('workflow.nodes.tool.authorizationRequired')).toBeVisible()
})

it('shows the invalid Reuse reference on the canvas instead of a Workspace authorization error', () => {
  const data = createNodeData()
  const { store } = renderTool(data, { authorized: false })
  act(() => {
    store.getState().setNodeReuseFromNode('tool-node-1', 'google_search', data.provider_id, {
      id: 'removed',
      title: 'Removed source',
    })
    store
      .getState()
      .setNodeAuthorizationTab('tool-node-1', 'google_search', data.provider_id, 'reuse-from-node')
  })
  expect(screen.getByText('workflow.panel.selectReuseNode')).toBeVisible()
  expect(screen.queryByText('workflow.nodes.tool.authorizationRequired')).not.toBeInTheDocument()
})
