import type { Node } from '../../types'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useStoreApi } from 'reactflow'
import { createNode } from '../../__tests__/fixtures'
import { renderWorkflowFlowComponent } from '../../__tests__/workflow-test-env'
import ScrollToSelectedNodeButton from '../scroll-to-selected-node-button'

const mockScrollToWorkflowNode = vi.fn()

vi.mock('../../utils/node-navigation', () => ({
  scrollToWorkflowNode: (nodeId: string) => mockScrollToWorkflowNode(nodeId),
}))

const SelectionControls = () => {
  const store = useStoreApi()
  const updateNodes = (update: (nodes: Node[]) => Node[]) => {
    const { getNodes, setNodes } = store.getState()
    setNodes(update(getNodes() as Node[]))
  }
  return (
    <>
      <button
        type="button"
        onClick={() =>
          updateNodes((nodes) =>
            nodes.map((node) => ({
              ...node,
              data: { ...node.data, selected: node.id === 'node-2' },
            })),
          )
        }
      >
        Select second node
      </button>
      <button
        type="button"
        onClick={() => updateNodes((nodes) => nodes.filter((node) => !node.data.selected))}
      >
        Remove selected node
      </button>
    </>
  )
}

describe('ScrollToSelectedNodeButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render nothing when there is no selected node', () => {
    const nodes = [
      createNode({
        id: 'node-1',
        data: { selected: false },
      }),
    ]

    renderWorkflowFlowComponent(<ScrollToSelectedNodeButton />, { nodes })

    expect(
      screen.queryByRole('button', { name: 'workflow.panel.scrollToSelectedNode' }),
    ).not.toBeInTheDocument()
  })

  it('should render a button and scroll to the selected node when clicked', async () => {
    const user = userEvent.setup()
    const nodes = [
      createNode({
        id: 'node-1',
        data: { selected: false },
      }),
      createNode({
        id: 'node-2',
        data: { selected: true },
      }),
    ]

    renderWorkflowFlowComponent(<ScrollToSelectedNodeButton />, { nodes })

    const button = screen.getByRole('button', {
      name: 'workflow.panel.scrollToSelectedNode',
    })
    expect(button).toHaveAttribute('type', 'button')

    await user.click(button)

    expect(mockScrollToWorkflowNode).toHaveBeenCalledWith('node-2')
    expect(mockScrollToWorkflowNode).toHaveBeenCalledTimes(1)
  })

  it('should support native keyboard activation', async () => {
    const user = userEvent.setup()
    const nodes = [
      createNode({
        id: 'node-2',
        data: { selected: true },
      }),
    ]

    renderWorkflowFlowComponent(<ScrollToSelectedNodeButton />, {
      nodes,
      reactFlowProps: { panActivationKeyCode: null },
    })

    const button = screen.getByRole('button', {
      name: 'workflow.panel.scrollToSelectedNode',
    })
    button.focus()
    await user.keyboard('{Enter}')
    await user.keyboard(' ')

    expect(mockScrollToWorkflowNode).toHaveBeenNthCalledWith(1, 'node-2')
    expect(mockScrollToWorkflowNode).toHaveBeenNthCalledWith(2, 'node-2')
  })

  it('follows the current selection and disappears when that node is removed', async () => {
    const user = userEvent.setup()
    renderWorkflowFlowComponent(
      <>
        <SelectionControls />
        <ScrollToSelectedNodeButton />
      </>,
      {
        nodes: [
          createNode({ id: 'node-1', data: { selected: true } }),
          createNode({ id: 'node-2', data: { selected: false } }),
        ],
      },
    )

    await user.click(screen.getByRole('button', { name: 'workflow.panel.scrollToSelectedNode' }))
    expect(mockScrollToWorkflowNode).toHaveBeenLastCalledWith('node-1')

    await user.click(screen.getByRole('button', { name: 'Select second node' }))
    await user.click(screen.getByRole('button', { name: 'workflow.panel.scrollToSelectedNode' }))
    expect(mockScrollToWorkflowNode).toHaveBeenLastCalledWith('node-2')

    await user.click(screen.getByRole('button', { name: 'Remove selected node' }))
    expect(
      screen.queryByRole('button', { name: 'workflow.panel.scrollToSelectedNode' }),
    ).not.toBeInTheDocument()
  })
})
