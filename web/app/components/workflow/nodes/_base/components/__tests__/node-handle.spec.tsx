import type { NodeProps } from 'reactflow'
import type { InjectWorkflowStoreSliceFn } from '@/app/components/workflow/store'
import type { CommonNodeType, Edge } from '@/app/components/workflow/types'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEdges } from 'reactflow'
import { createWorkflowSlice } from '@/app/components/workflow-app/store/workflow/workflow-slice'
import {
  CANVAS_NODES_STATUS_NAME,
  CanvasNodesCatalogProbe,
} from '@/app/components/workflow/__tests__/canvas-nodes-catalog-probe'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { CUSTOM_NODE } from '@/app/components/workflow/constants'
import { BlockEnum } from '@/app/components/workflow/types'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper, seedAppDslVersion } from '@/test/console/query-data'
import { NodeSourceHandle, NodeTargetHandle } from '../node-handle'

vi.mock('@/service/use-plugins', () => ({
  useFeaturedToolsRecommendations: () => ({ plugins: [], isLoading: false }),
  useFeaturedTriggersRecommendations: () => ({ plugins: [], isLoading: false }),
}))

vi.mock('@/service/use-triggers', () => ({
  useAllTriggerPlugins: () => ({ data: [] }),
  useInvalidateAllTriggerPlugins: () => vi.fn(),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.tools.builtin.get': async () => [],
      'workspaces.current.tools.api.get': async () => [],
      'workspaces.current.tools.workflow.get': async () => [],
      'workspaces.current.tools.mcp.get': async () => [],
    }),
  }
})

vi.mock('@/app/components/plugins/marketplace/query', () => ({
  useMarketplacePlugins: () => ({ data: undefined }),
}))

function SourceHandleNode({ id, data }: NodeProps<CommonNodeType>) {
  return (
    <div role="group" aria-label={data.title}>
      <span>{data.title}</span>
      <NodeSourceHandle id={id} data={data} handleId="source-handle" />
    </div>
  )
}

function TargetHandleNode({ id, data }: NodeProps<CommonNodeType>) {
  return (
    <div role="group" aria-label={data.title}>
      <span>{data.title}</span>
      <NodeTargetHandle id={id} data={data} handleId="target-handle" />
    </div>
  )
}

function CanvasEdgesProbe() {
  const edges = useEdges<Edge['data']>()
  return (
    <output aria-label="Canvas edges">
      {edges
        .map(
          (edge) =>
            `${edge.source}:${edge.sourceHandle ?? ''}->${edge.target}:${edge.targetHandle ?? ''}`,
        )
        .join(',')}
    </output>
  )
}

const getCanvasNodeIds = () =>
  screen
    .getByLabelText(CANVAS_NODES_STATUS_NAME, { selector: 'output' })
    .textContent!.split(',')
    .filter(Boolean)
    .map((nodeId) => nodeId.replace(/\*$/, ''))

function renderHandle({
  side,
  type = BlockEnum.Code,
  readOnly = false,
  autoOpen = false,
  chatflow = false,
  connected = false,
}: {
  side: 'source' | 'target'
  type?: BlockEnum
  readOnly?: boolean
  autoOpen?: boolean
  chatflow?: boolean
  connected?: boolean
}) {
  const id = side === 'source' ? 'source-node' : 'target-node'
  const title = side === 'source' ? 'Source node' : 'Target node'
  const nodes = [
    createNode({
      id,
      width: 240,
      height: 80,
      position: { x: side === 'source' ? 100 : 500, y: 100 },
      data: {
        type,
        title,
        ...(connected && side === 'target' ? { _connectedTargetHandleIds: ['target-handle'] } : {}),
      },
    }),
  ]
  const { queryClient } = createConsoleQueryWrapper({ appDslVersion: '1.0.0' })
  seedModelProviderQueries(queryClient)
  seedAppDslVersion(queryClient, '1.0.0')

  return renderWorkflowFlowComponent(
    <>
      <CanvasNodesCatalogProbe />
      <CanvasEdgesProbe />
    </>,
    {
      nodes,
      edges: [],
      queryClient,
      resource: { kind: 'app', appId: 'app-1', mode: chatflow ? 'advanced-chat' : 'workflow' },
      injectWorkflowStoreSliceFn: createWorkflowSlice as InjectWorkflowStoreSliceFn,
      initialStoreState: {
        canvasReadOnly: readOnly,
        shouldAutoOpenStartNodeSelector: autoOpen,
        hasSelectedStartNode: true,
      },
      hooksStoreProps: { doSyncWorkflowDraft: async () => null },
      reactFlowProps: {
        fitView: false,
        nodeTypes: {
          [CUSTOM_NODE]: side === 'source' ? SourceHandleNode : TargetHandleNode,
        },
      },
    },
  )
}

describe('node handle insertion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('inserts and routes a node after the source handle through the real selector', async () => {
    const user = userEvent.setup()
    renderHandle({ side: 'source' })
    const source = await screen.findByRole('group', { name: 'Source node' })

    await user.click(within(source).getByRole('button', { name: 'workflow.common.addBlock' }))
    expect(screen.getByRole('tab', { name: 'workflow.tabs.start' })).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'workflow.blocks.code' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const nodeIds = getCanvasNodeIds()
    expect(nodeIds).toHaveLength(2)
    const insertedNodeId = nodeIds.find((nodeId) => nodeId !== 'source-node')!
    expect(screen.getByLabelText('Canvas edges')).toHaveTextContent(
      `source-node:source-handle->${insertedNodeId}:target`,
    )
  })

  it('inserts and routes a node before the target handle through the real selector', async () => {
    const user = userEvent.setup()
    renderHandle({ side: 'target' })
    const target = await screen.findByRole('group', { name: 'Target node' })

    await user.click(within(target).getByRole('button', { name: 'workflow.common.addBlock' }))
    expect(screen.getByRole('tab', { name: 'workflow.tabs.start' })).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'workflow.blocks.code' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const nodeIds = getCanvasNodeIds()
    expect(nodeIds).toHaveLength(2)
    const insertedNodeId = nodeIds.find((nodeId) => nodeId !== 'target-node')!
    expect(screen.getByLabelText('Canvas edges')).toHaveTextContent(
      `${insertedNodeId}:source->target-node:target-handle`,
    )
  })

  it('does not offer insertion from a connected target handle', async () => {
    renderHandle({ side: 'target', connected: true })
    const target = await screen.findByRole('group', { name: 'Target node' })

    expect(
      within(target).queryByRole('button', { name: 'workflow.common.addBlock' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(getCanvasNodeIds()).toEqual(['target-node'])
  })

  it.each([
    BlockEnum.Start,
    BlockEnum.TriggerSchedule,
    BlockEnum.TriggerWebhook,
    BlockEnum.TriggerPlugin,
  ])(
    'auto-opens an entry-node selector once for %s and resets the workflow flags',
    async (type) => {
      const user = userEvent.setup()
      const { store } = renderHandle({ side: 'source', type, autoOpen: true })

      expect(await screen.findByRole('dialog')).toBeInTheDocument()
      expect(store.getState().shouldAutoOpenStartNodeSelector).toBe(false)
      expect(store.getState().hasSelectedStartNode).toBe(false)

      await user.keyboard('{Escape}')
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    },
  )

  it('preserves the previous focus when the entry selector opens automatically', async () => {
    const user = userEvent.setup()
    render(<button type="button">Previous action</button>)
    const previousAction = screen.getByRole('button', { name: 'Previous action' })
    await user.click(previousAction)

    renderHandle({ side: 'source', type: BlockEnum.Start, autoOpen: true })
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    await user.keyboard('{Escape}')

    await waitFor(() => expect(previousAction).toHaveFocus())
  })

  it('skips auto-open for chatflow and resets only the request flag', () => {
    const { store } = renderHandle({
      side: 'source',
      type: BlockEnum.Start,
      autoOpen: true,
      chatflow: true,
    })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(store.getState().shouldAutoOpenStartNodeSelector).toBe(false)
    expect(store.getState().hasSelectedStartNode).toBe(true)
  })

  it('retains the auto-open request for a non-entry node', () => {
    const { store } = renderHandle({ side: 'source', type: BlockEnum.Code, autoOpen: true })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(store.getState().shouldAutoOpenStartNodeSelector).toBe(true)
    expect(store.getState().hasSelectedStartNode).toBe(true)
  })

  it('does not expose insertion controls or mutate the graph on a readonly canvas', async () => {
    const { store } = renderHandle({
      side: 'source',
      type: BlockEnum.Start,
      readOnly: true,
      autoOpen: true,
    })
    const source = await screen.findByRole('group', { name: 'Source node' })

    expect(
      within(source).queryByRole('button', { name: 'workflow.common.addBlock' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(getCanvasNodeIds()).toEqual(['source-node'])
    expect(screen.getByLabelText('Canvas edges')).toBeEmptyDOMElement()
    expect(store.getState().shouldAutoOpenStartNodeSelector).toBe(false)
  })
})
