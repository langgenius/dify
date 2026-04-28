import type { WorkflowRunningData } from '../../../types'
import { createStore } from 'zustand/vanilla'
import { WorkflowRunningStatus } from '../../../types'
import { createWorkflowSlice } from '../workflow-slice'

describe('createWorkflowSlice', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('defaults to pointer mode and restores persisted control mode', () => {
    const defaultStore = createStore(createWorkflowSlice)

    expect(defaultStore.getState().controlMode).toBe('pointer')

    localStorage.setItem('workflow-operation-mode', 'hand')
    const persistedStore = createStore(createWorkflowSlice)

    expect(persistedStore.getState().controlMode).toBe('hand')
  })

  it('persists control mode updates and stores run state payloads', () => {
    const store = createStore(createWorkflowSlice)
    const workflowRunningData: WorkflowRunningData & { resultText: string } = {
      result: {
        status: WorkflowRunningStatus.Running,
        inputs_truncated: false,
        process_data_truncated: false,
        outputs_truncated: false,
      },
      resultText: 'streaming',
    }

    store.getState().setControlMode('pointer')
    store.getState().setWorkflowRunningData(workflowRunningData)

    expect(store.getState().controlMode).toBe('pointer')
    expect(localStorage.getItem('workflow-operation-mode')).toBe('pointer')
    expect(store.getState().workflowRunningData?.resultText).toBe('streaming')
  })
})
