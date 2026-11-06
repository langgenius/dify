import type { CommonNodeType, Edge } from '../types'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Position, useEdges, useNodes } from 'reactflow'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import CustomEdge from '../custom-edge'
import { BlockEnum } from '../types'
import { CanvasNodesCatalogProbe } from './canvas-nodes-catalog-probe'
import { createEdge, createNode } from './fixtures'
import { renderWorkflowFlowComponent } from './workflow-test-env'

function CanvasEdgesProbe() {
  const edges = useEdges<Edge['data']>()
  return (
    <output aria-label="Canvas edges">
      {edges
        .map((edge) => `${edge.source}:${edge.sourceHandle}->${edge.target}:${edge.targetHandle}`)
        .join(',')}
    </output>
  )
}

function CanvasNodeTypesProbe() {
  const nodes = useNodes<CommonNodeType>()
  return (
    <output aria-label="Canvas node types">
      {nodes.map((node) => `${node.id}:${node.data.type}`).join(',')}
    </output>
  )
}

describe('CustomEdge insertion', () => {
  it('offers compatible blocks without a start tab and inserts between the connected handles', async () => {
    const user = userEvent.setup()
    const { queryClient } = createConsoleQueryWrapper({ appDslVersion: '1.0.0' })
    seedModelProviderQueries(queryClient)
    seedToolProviders(queryClient, {
      builtInTools: [],
      customTools: [],
      workflowTools: [],
      mcpTools: [],
    })
    const nodes = [
      createNode({
        id: 'source-node',
        position: { x: 100, y: 120 },
        width: 240,
        height: 80,
        data: { type: BlockEnum.Start, title: 'Start' },
      }),
      createNode({
        id: 'target-node',
        position: { x: 600, y: 220 },
        width: 240,
        height: 80,
        data: { type: BlockEnum.Code, title: 'Code' },
      }),
    ]
    const edges = [
      createEdge({
        id: 'edge',
        source: 'source-node',
        sourceHandle: 'branch',
        target: 'target-node',
        targetHandle: 'input',
        data: { sourceType: BlockEnum.Start, targetType: BlockEnum.Code },
      }),
    ]

    renderWorkflowFlowComponent(
      <>
        <svg>
          <CustomEdge
            id="edge"
            source="source-node"
            sourceHandleId="branch"
            target="target-node"
            targetHandleId="input"
            sourceX={100}
            sourceY={120}
            sourcePosition={Position.Right}
            targetX={600}
            targetY={220}
            targetPosition={Position.Left}
            selected={false}
            data={{ sourceType: BlockEnum.Start, targetType: BlockEnum.Code, _hovering: true }}
          />
        </svg>
        <CanvasNodesCatalogProbe />
        <CanvasNodeTypesProbe />
        <CanvasEdgesProbe />
      </>,
      {
        nodes,
        edges,
        queryClient,
        hooksStoreProps: { doSyncWorkflowDraft: async () => undefined },
        reactFlowProps: { fitView: false },
      },
    )

    await user.click(screen.getByRole('button', { name: 'workflow.common.addBlock' }))
    expect(screen.queryByRole('tab', { name: 'workflow.tabs.start' })).not.toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'workflow.blocks.llm' }))

    await waitFor(() => {
      const nodeIds = (screen.getByLabelText('Canvas nodes').textContent ?? '')
        .split(',')
        .filter(Boolean)
        .map((id) => id.replace(/\*$/, ''))
      expect(nodeIds).toHaveLength(3)
      const insertedNodeId = nodeIds.find((id) => !['source-node', 'target-node'].includes(id))!
      expect(screen.getByLabelText('Canvas node types')).toHaveTextContent(
        `${insertedNodeId}:${BlockEnum.LLM}`,
      )
      expect(screen.getByLabelText('Canvas edges')).toHaveTextContent(
        `source-node:branch->${insertedNodeId}:target`,
      )
      expect(screen.getByLabelText('Canvas edges')).toHaveTextContent(
        `${insertedNodeId}:source->target-node:input`,
      )
      expect(screen.getByLabelText('Canvas edges')).not.toHaveTextContent(
        'source-node:branch->target-node:input',
      )
    })
  })
})
