import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import ViewWorkflowHistory from '../view-workflow-history'

describe('ViewWorkflowHistory log session', () => {
  it('clears the selected message when history opens and closes with Escape', async () => {
    const user = userEvent.setup()
    const messageLogItem = {
      id: 'message-1',
      content: 'Answer',
      isAnswer: true,
      workflow_run_id: 'run-1',
    }
    const { store } = renderWorkflowFlowComponent(<ViewWorkflowHistory />, {
      nodes: [],
      edges: [],
      initialStoreState: { messageLogItem },
    })

    await user.click(screen.getByRole('button', { name: 'workflowHistory.changeHistory.title' }))
    expect(store.getState().messageLogItem).toBeUndefined()
    act(() => store.getState().setMessageLogItem(messageLogItem))
    await user.keyboard('{Escape}')
    expect(store.getState().messageLogItem).toBeUndefined()
  })
})
