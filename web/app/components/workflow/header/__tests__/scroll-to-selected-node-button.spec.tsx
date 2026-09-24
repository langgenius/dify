import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createNode } from '../../__tests__/fixtures'
import { resetReactFlowMockState, rfState } from '../../__tests__/reactflow-mock-state'
import ScrollToSelectedNodeButton from '../scroll-to-selected-node-button'

const mockScrollToWorkflowNode = vi.fn()

vi.mock('reactflow', async () =>
  (await import('../../__tests__/reactflow-mock-state')).createReactFlowModuleMock(),
)

vi.mock('../../utils/node-navigation', () => ({
  scrollToWorkflowNode: (nodeId: string) => mockScrollToWorkflowNode(nodeId),
}))

describe('ScrollToSelectedNodeButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetReactFlowMockState()
  })

  it('should render nothing when there is no selected node', () => {
    rfState.nodes = [
      createNode({
        id: 'node-1',
        data: { selected: false },
      }),
    ]

    const { container } = render(<ScrollToSelectedNodeButton />)

    expect(container.firstChild).toBeNull()
  })

  it('should render a button and scroll to the selected node when clicked', async () => {
    const user = userEvent.setup()
    rfState.nodes = [
      createNode({
        id: 'node-1',
        data: { selected: false },
      }),
      createNode({
        id: 'node-2',
        data: { selected: true },
      }),
    ]

    render(<ScrollToSelectedNodeButton />)

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
    rfState.nodes = [
      createNode({
        id: 'node-2',
        data: { selected: true },
      }),
    ]

    render(<ScrollToSelectedNodeButton />)

    const button = screen.getByRole('button', {
      name: 'workflow.panel.scrollToSelectedNode',
    })
    button.focus()
    await user.keyboard('{Enter}')
    await user.keyboard(' ')

    expect(mockScrollToWorkflowNode).toHaveBeenNthCalledWith(1, 'node-2')
    expect(mockScrollToWorkflowNode).toHaveBeenNthCalledWith(2, 'node-2')
  })
})
