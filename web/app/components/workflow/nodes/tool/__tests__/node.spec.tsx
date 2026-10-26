import type { RefObject } from 'react'
import type { ReactFlowInstance } from 'reactflow'
import type { ToolNodeType } from '../types'
import type { Node as WorkflowNode } from '@/app/components/workflow/types'
import { act, screen } from '@testing-library/react'
import { createRef, useImperativeHandle } from 'react'
import ReactFlow, { ReactFlowProvider, useReactFlow } from 'reactflow'
import { CollectionType } from '@/app/components/tools/types'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
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

function GraphApi({ graphRef }: { graphRef: RefObject<ReactFlowInstance | null> }) {
  const graph = useReactFlow()
  useImperativeHandle(graphRef, () => graph, [graph])
  return null
}

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
  const graph = createRef<ReactFlowInstance>()
  const content = (nodeData: ToolNodeType) => (
    <ReactFlowProvider>
      <ReactFlow defaultNodes={nodes} />
      <GraphApi graphRef={graph} />
      <Node id="tool-node-1" data={nodeData} />
    </ReactFlowProvider>
  )
  const view = renderWorkflowComponent(content(data), { queryClient })
  return { ...view, graph, update: (nodeData: ToolNodeType) => view.rerender(content(nodeData)) }
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

  it('updates App user errors on the canvas from saved node data', () => {
    const data = createNodeData()
    const { update } = renderTool(data, { authorized: false })
    expect(screen.getByText('workflow.nodes.tool.authorizationRequired')).toBeInTheDocument()
    const appUser = createNodeData({
      credential_source: 'end_user',
      end_user_auth: { allowed_credential_types: ['oauth2', 'api-key'], purpose: '' },
    })
    update(appUser)
    expect(screen.getByText('plugin.auth.appUser.clientRequired')).toBeInTheDocument()
    expect(screen.getByText('plugin.auth.appUser.descriptionRequired')).toBeInTheDocument()
    expect(screen.queryByText('workflow.nodes.tool.authorizationRequired')).not.toBeInTheDocument()

    update({ ...appUser, end_user_auth: { allowed_credential_types: ['api-key'], purpose: '' } })
    expect(screen.queryByText('plugin.auth.appUser.clientRequired')).not.toBeInTheDocument()
    expect(screen.getByText('plugin.auth.appUser.descriptionRequired')).toBeInTheDocument()

    update({
      ...appUser,
      end_user_auth: { allowed_credential_types: ['api-key'], purpose: 'Find repositories' },
    })
    expect(screen.queryByText('plugin.auth.appUser.descriptionRequired')).not.toBeInTheDocument()
    expect(screen.queryByText('workflow.nodes.tool.authorizationRequired')).not.toBeInTheDocument()

    update({ ...appUser, end_user_auth: { allowed_credential_types: [], purpose: ' ' } })
    expect(screen.getByText('plugin.auth.appUser.selectMethod')).toBeInTheDocument()
    expect(screen.getByText('plugin.auth.appUser.descriptionRequired')).toBeInTheDocument()
    expect(screen.queryByText('plugin.auth.appUser.clientRequired')).not.toBeInTheDocument()

    update(data)
    expect(screen.getByText('workflow.nodes.tool.authorizationRequired')).toBeInTheDocument()
    expect(screen.queryByText('plugin.auth.appUser.selectMethod')).not.toBeInTheDocument()
    expect(screen.queryByText('plugin.auth.appUser.descriptionRequired')).not.toBeInTheDocument()
  })
})

it('does not repeat its Reuse source App user or Workspace authorization errors on the canvas', () => {
  const data = createNodeData({ credential_source: 'reuse_node', reuse_node_id: 'auth-source' })
  const source = createNode({
    id: 'auth-source',
    data: createNodeData({
      credential_source: 'end_user',
      end_user_auth: { allowed_credential_types: ['oauth2', 'api-key'], purpose: '' },
    }),
  })
  const { graph } = renderTool(data, { authorized: false, nodes: [source] })
  expect(screen.queryByText('plugin.auth.appUser.clientRequired')).not.toBeInTheDocument()
  expect(screen.queryByText('plugin.auth.appUser.descriptionRequired')).not.toBeInTheDocument()
  expect(screen.queryByText('workflow.nodes.tool.authorizationRequired')).not.toBeInTheDocument()
  act(() =>
    graph.current?.setNodes([
      {
        ...source,
        data: {
          ...source.data,
          end_user_auth: { allowed_credential_types: [], purpose: 'Find repositories' },
        },
      },
    ]),
  )
  expect(screen.queryByText('plugin.auth.appUser.descriptionRequired')).not.toBeInTheDocument()
  expect(screen.queryByText('plugin.auth.appUser.selectMethod')).not.toBeInTheDocument()
  expect(screen.queryByText('workflow.nodes.tool.authorizationRequired')).not.toBeInTheDocument()
  act(() =>
    graph.current?.setNodes([
      {
        ...source,
        data: { ...source.data, credential_source: 'workspace', end_user_auth: undefined },
      },
    ]),
  )
  expect(screen.queryByText('workflow.nodes.tool.authorizationRequired')).not.toBeInTheDocument()
})

it('shows the invalid Reuse reference on the canvas instead of a Workspace authorization error', () => {
  renderTool(createNodeData({ credential_source: 'reuse_node', reuse_node_id: 'removed' }), {
    authorized: false,
  })
  expect(screen.getByText('workflow.panel.selectReuseNode')).toBeVisible()
  expect(screen.queryByText('workflow.nodes.tool.authorizationRequired')).not.toBeInTheDocument()
})
