import type { ResizeParamsWithDirection } from 'reactflow'
import type { CommonNodeType } from '@/app/components/workflow/types'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useNodes } from 'reactflow'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum } from '@/app/components/workflow/types'
import NodeResizer from '../node-resizer'

const resize = vi.hoisted(() => vi.fn())
const permissions = vi.hoisted(() => ({ readonly: false }))

// Graph mutation owns draft persistence and history; keep React Flow and the resize UI real.
vi.mock('../../../../hooks/use-nodes-interactions', async () => {
  const { useStoreApi } = await import('reactflow')
  return {
    useNodesInteractions: () => {
      const store = useStoreApi()
      return {
        handleNodeResize: (id: string, params: ResizeParamsWithDirection) => {
          resize(id, params)
          store.getState().setNodes(
            store
              .getState()
              .getNodes()
              .map((node) =>
                node.id === id
                  ? {
                      ...node,
                      width: params.width,
                      height: params.height,
                      data: { ...node.data, width: params.width, height: params.height },
                    }
                  : node,
              ),
          )
        },
      }
    },
  }
})

vi.mock('../../../../hooks/use-workflow', () => ({
  useNodesReadOnly: () => ({ nodesReadOnly: permissions.readonly }),
}))

function ResizableNode() {
  const node = useNodes<CommonNodeType>().find((node) => node.id === 'container')!
  if (!node) return null
  return (
    <>
      <NodeResizer nodeId={node.id} nodeData={node.data} />
      <output aria-label="Node size">
        {node.data.width} × {node.data.height}
      </output>
    </>
  )
}

describe('NodeResizer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    permissions.readonly = false
  })

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
    renderWorkflowFlowComponent(<ResizableNode />, {
      nodes: [
        container(),
        createNode({
          id: 'child',
          parentId: 'container',
          position: { x: 100, y: 100 },
          width: 240,
          height: 100,
        }),
      ],
    })
    const control = await screen.findByRole('button', { name: 'common.resize.node' })
    control.focus()
    await user.keyboard('{ArrowRight}{Shift>}{ArrowDown}{/Shift}')
    expect(screen.getByRole('status', { name: 'Node size' })).toHaveTextContent('508 × 432')
    expect(resize).toHaveBeenLastCalledWith(
      'container',
      expect.objectContaining({ x: 50, y: 70, width: 508, height: 432 }),
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

  it('keeps the resize action available when the node is not selected', async () => {
    const node = container()
    node.data.selected = false
    renderWorkflowFlowComponent(<ResizableNode />, { nodes: [node] })
    expect(await screen.findByRole('button', { name: 'common.resize.node' })).toBeEnabled()
  })

  it('does not offer resizing on a readonly canvas', async () => {
    permissions.readonly = true
    renderWorkflowFlowComponent(<ResizableNode />, { nodes: [container()] })
    await screen.findByRole('status', { name: 'Node size' })
    expect(screen.queryByRole('button', { name: 'common.resize.node' })).not.toBeInTheDocument()
  })
})
