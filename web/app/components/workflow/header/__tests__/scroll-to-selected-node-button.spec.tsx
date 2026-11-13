import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createNode } from '../../__tests__/fixtures'
import { renderWorkflowFlowComponent } from '../../__tests__/workflow-test-env'
import ScrollToSelectedNodeButton from '../scroll-to-selected-node-button'

it('hides the navigation action when no node is selected', () => {
  renderWorkflowFlowComponent(<ScrollToSelectedNodeButton />, {
    nodes: [createNode({ id: 'node-1', data: { selected: false } })],
  })
  expect(
    screen.queryByRole('button', { name: 'workflow.panel.scrollToSelectedNode' }),
  ).not.toBeInTheDocument()
})

it('dispatches a scroll request for the selected node', async () => {
  const user = userEvent.setup()
  const scroll = vi.fn()
  document.addEventListener('workflow:scroll-to-node', scroll)
  try {
    renderWorkflowFlowComponent(<ScrollToSelectedNodeButton />, {
      nodes: [
        createNode({ id: 'node-1', data: { selected: false } }),
        createNode({ id: 'node-2', data: { selected: true } }),
      ],
    })
    await user.click(screen.getByRole('button', { name: 'workflow.panel.scrollToSelectedNode' }))
    expect(scroll).toHaveBeenCalledOnce()
    expect(scroll.mock.calls[0]![0].detail).toEqual({ nodeId: 'node-2' })
  } finally {
    document.removeEventListener('workflow:scroll-to-node', scroll)
  }
})
