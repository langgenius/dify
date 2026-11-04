import type { CommonNodeType } from '@/app/components/workflow/types'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useNodes } from 'reactflow'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum } from '@/app/components/workflow/types'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import NodeResizer from '../node-resizer'

function ResizableNode() {
  const node = useNodes<CommonNodeType>().find((node) => node.id === 'container')!
  if (!node) return null
  return (
    <>
      <NodeResizer nodeId={node.id} nodeData={node.data} />
      <output aria-label="Node size">
        {node.data.width} × {node.data.height}
      </output>
      <output aria-label="Node position">{JSON.stringify(node.position)}</output>
    </>
  )
}

describe('NodeResizer', () => {
  const createQueryClient = () => {
    const { queryClient } = createConsoleQueryWrapper({ appDslVersion: '1.0.0' })
    seedModelProviderQueries(queryClient)
    return queryClient
  }

  const container = () =>
    createNode({
      id: 'container',
      position: { x: 50, y: 70 },
      width: 500,
      height: 400,
      data: {
        type: BlockEnum.Iteration,
        title: 'Iteration',
        desc: '',
        width: 500,
        height: 400,
        selected: true,
        _children: [{ nodeId: 'child', nodeType: BlockEnum.Code }],
      },
    })

  it('resizes both dimensions without moving the node and shrinks only as far as its contents allow', async () => {
    const user = userEvent.setup()
    const nodes = [
      container(),
      createNode({
        id: 'child',
        parentId: 'container',
        position: { x: 100, y: 100 },
        width: 240,
        height: 100,
      }),
    ]
    renderWorkflowFlowComponent(<ResizableNode />, {
      nodes,
      historyStore: { nodes, edges: [] },
      hooksStoreProps: { doSyncWorkflowDraft: async () => undefined },
      queryClient: createQueryClient(),
    })
    const control = await screen.findByRole('button', { name: 'common.resize.node' })
    control.focus()
    await user.keyboard('{ArrowRight}{Shift>}{ArrowDown}{/Shift}')
    expect(screen.getByRole('status', { name: 'Node size' })).toHaveTextContent('508 × 432')
    expect(screen.getByRole('status', { name: 'Node position' })).toHaveTextContent(
      '{"x":50,"y":70}',
    )
    await user.keyboard('{Home}')
    expect(screen.getByRole('status', { name: 'Node size' })).toHaveTextContent('356 × 220')
    await user.keyboard('{ArrowLeft}{ArrowUp}')
    expect(screen.getByRole('status', { name: 'Node size' })).toHaveTextContent('356 × 220')
    await user.keyboard('{ArrowRight}{ArrowDown}{Enter}')
    expect(screen.getByRole('status', { name: 'Node size' })).toHaveTextContent('356 × 220')
    await user.keyboard('{End}')
    expect(screen.getByRole('status', { name: 'Node size' })).toHaveTextContent('356 × 220')
  })

  it('does not offer resizing on a readonly canvas', async () => {
    renderWorkflowFlowComponent(<ResizableNode />, {
      nodes: [container()],
      initialStoreState: { canvasReadOnly: true },
      queryClient: createQueryClient(),
    })
    await screen.findByRole('status', { name: 'Node size' })
    expect(screen.queryByRole('button', { name: 'common.resize.node' })).not.toBeInTheDocument()
  })
})
