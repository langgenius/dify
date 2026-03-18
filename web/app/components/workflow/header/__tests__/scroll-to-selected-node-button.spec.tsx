import { fireEvent, render, screen } from '@testing-library/react'
import { createNode } from '../../__tests__/fixtures'
import { resetReactFlowMockState, rfState } from '../../__tests__/reactflow-mock-state'
import ScrollToSelectedNodeButton from '../scroll-to-selected-node-button'

const mockScrollToWorkflowNode = vi.fn()

vi.mock('reactflow', async () =>
  (await import('../../__tests__/reactflow-mock-state')).createReactFlowModuleMock())

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

  it('should render the action and scroll to the selected node when clicked', () => {
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

    fireEvent.click(screen.getByText('workflow.panel.scrollToSelectedNode'))

    expect(mockScrollToWorkflowNode).toHaveBeenCalledWith('node-2')
    expect(mockScrollToWorkflowNode).toHaveBeenCalledTimes(1)
  })
})
