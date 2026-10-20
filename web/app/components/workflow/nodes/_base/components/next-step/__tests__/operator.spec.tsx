import type { CommonNodeType, Edge } from '@/app/components/workflow/types'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { useEdges } from 'reactflow'
import { CanvasNodesCatalogProbe } from '@/app/components/workflow/__tests__/canvas-nodes-catalog-probe'
import { createEdge, createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum } from '@/app/components/workflow/types'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import Operator from '../operator'

const defaultNodeData = {
  type: BlockEnum.Code,
  title: 'Code Node',
  desc: '',
} satisfies CommonNodeType

const TestHarness = () => {
  const [open, setOpen] = useState(false)
  return (
    <Operator
      open={open}
      onOpenChange={setOpen}
      data={defaultNodeData}
      nodeId="node-1"
      sourceHandle="source"
    />
  )
}

function CanvasEdgesProbe() {
  const edges = useEdges<Edge['data']>()
  return <output aria-label="Canvas edges">{edges.map((edge) => edge.id).join(',')}</output>
}

function renderOperator() {
  const { queryClient } = createConsoleQueryWrapper({ appDslVersion: '1.0.0' })
  seedModelProviderQueries(queryClient)
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  return renderWorkflowFlowComponent(
    <>
      <TestHarness />
      <CanvasNodesCatalogProbe />
      <CanvasEdgesProbe />
    </>,
    {
      nodes: [
        createNode({ id: 'previous', width: 240, height: 80 }),
        createNode({
          id: 'node-1',
          position: { x: 320, y: 0 },
          width: 240,
          height: 80,
          data: defaultNodeData,
        }),
        createNode({ id: 'next', position: { x: 640, y: 0 }, width: 240, height: 80 }),
      ],
      edges: [
        createEdge({ id: 'incoming', source: 'previous', target: 'node-1' }),
        createEdge({ id: 'outgoing', source: 'node-1', target: 'next' }),
        createEdge({ id: 'unrelated', source: 'previous', target: 'next' }),
      ],
      queryClient,
      hooksStoreProps: { doSyncWorkflowDraft: async () => undefined },
      reactFlowProps: { fitView: false },
    },
  )
}

const canvasNodeIds = () =>
  (screen.getByLabelText('Canvas nodes').textContent ?? '')
    .split(',')
    .filter(Boolean)
    .map((id) => id.replace(/\*$/, ''))

describe('NextStep operator', () => {
  it('disconnects incident edges, then deletes the next step and closes the menu', async () => {
    const user = userEvent.setup()
    renderOperator()

    await user.click(screen.getByRole('button', { name: 'workflow.common.moreActions' }))
    await user.click(screen.getByRole('menuitem', { name: 'workflow.common.disconnect' }))

    await waitFor(() =>
      expect(screen.getByLabelText('Canvas edges')).toHaveTextContent('unrelated'),
    )
    expect(screen.getByLabelText('Canvas edges')).not.toHaveTextContent('incoming')
    expect(screen.getByLabelText('Canvas edges')).not.toHaveTextContent('outgoing')
    expect(canvasNodeIds()).toEqual(['previous', 'node-1', 'next'])
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'workflow.common.moreActions' }))
    await user.click(screen.getByRole('menuitem', { name: 'common.operation.delete' }))

    await waitFor(() => expect(canvasNodeIds()).toEqual(['previous', 'next']))
    expect(screen.getByLabelText('Canvas edges')).toHaveTextContent('unrelated')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('opens the node selector from the change menu item with the keyboard', async () => {
    const user = userEvent.setup()
    renderOperator()

    const trigger = screen.getByRole('button', { name: 'workflow.common.moreActions' })
    for (let attempt = 0; attempt < 10 && document.activeElement !== trigger; attempt++)
      await user.tab()
    expect(trigger).toHaveFocus()
    await user.keyboard('{ArrowDown}{Enter}')

    expect(
      await screen.findByRole('dialog', { name: 'workflow.common.addBlock' }),
    ).toBeInTheDocument()
  })
})
