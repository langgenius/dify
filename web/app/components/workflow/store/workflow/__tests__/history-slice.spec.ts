import type { HistoryWorkflowData } from '@/app/components/workflow/types'
import type { VersionHistory } from '@/types/workflow'
import { createStore } from 'zustand/vanilla'
import { createHistorySlice } from '../history-slice'

describe('createHistorySlice', () => {
  it('stores history workflow data and version history state', () => {
    const store = createStore(createHistorySlice)
    const historyWorkflowData = {
      nodes: [],
      edges: [],
      features: {
        opening_statement: '',
        suggested_questions: [],
        suggested_questions_after_answer: {
          enabled: false,
        },
      },
      environment_variables: [],
      conversation_variables: [],
    } as unknown as HistoryWorkflowData
    const versionHistory = [
      {
        id: 'version-1',
        created_at: 1,
        created_by: 'user-1',
      },
    ] as unknown as VersionHistory[]

    store.getState().setHistoryWorkflowData(historyWorkflowData)
    store.getState().setShowRunHistory(true)
    store.getState().setVersionHistory(versionHistory)

    expect(store.getState().historyWorkflowData).toBe(historyWorkflowData)
    expect(store.getState().showRunHistory).toBe(true)
    expect(store.getState().versionHistory).toBe(versionHistory)
  })
})
