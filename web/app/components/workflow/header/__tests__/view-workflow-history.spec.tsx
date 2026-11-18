import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { collaborationManager } from '../../collaboration/core/collaboration-manager'
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

it('jumps and clears only the editor’s collaborative history', async () => {
  const user = userEvent.setup()
  const history = { undo: ['NodeChange', 'NodeConnect'] as const, redo: [] }
  vi.spyOn(collaborationManager, 'isDraftHistoryReady').mockReturnValue(true)
  vi.spyOn(collaborationManager, 'getDraftHistory').mockReturnValue(history)
  const undo = vi.spyOn(collaborationManager, 'undo').mockReturnValue(true)
  const clear = vi.spyOn(collaborationManager, 'clearUndoStack').mockImplementation(() => {})
  const { store } = renderWorkflowFlowComponent(<ViewWorkflowHistory />, {
    nodes: [],
    edges: [],
    resource: { kind: 'app', appId: 'app-1', mode: 'workflow', collaborationEnabled: true },
    initialStoreState: { loroDraft: { epoch: 'initial', accountId: 'editor', format: 2 } },
  })
  const localUndo = vi.spyOn(store.temporal.getState(), 'undo')
  const localClear = vi.spyOn(store.temporal.getState(), 'clear')
  const open = screen.getByRole('button', { name: 'workflowHistory.changeHistory.title' })
  await user.click(open)
  await user.click(screen.getByRole('button', { name: /sessionStart/ }))
  expect(undo).toHaveBeenCalledTimes(2)
  await user.click(open)
  await user.click(screen.getByRole('button', { name: /clearHistory/ }))
  expect(clear).toHaveBeenCalledOnce()
  expect(localUndo).not.toHaveBeenCalled()
  expect(localClear).not.toHaveBeenCalled()
})
