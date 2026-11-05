import type { StateCreator } from 'zustand'
import type { SliceFromInjection } from './store/workflow'
import { createContext, useState } from 'react'
import { createWorkflowStore } from './store/workflow'

type WorkflowStore = ReturnType<typeof createWorkflowStore>
export const WorkflowContext = createContext<WorkflowStore | null>(null)

type WorkflowProviderProps = {
  children: React.ReactNode
  injectWorkflowStoreSliceFn?: StateCreator<SliceFromInjection>
  initialCollaborationEnabled?: boolean
}
export const WorkflowContextProvider = ({
  children,
  injectWorkflowStoreSliceFn,
  initialCollaborationEnabled,
}: WorkflowProviderProps) => {
  // Keep the editing session in one persistence mode even if workspace features refresh.
  const [store] = useState(() =>
    createWorkflowStore({ injectWorkflowStoreSliceFn, initialCollaborationEnabled }),
  )

  return <WorkflowContext.Provider value={store}>{children}</WorkflowContext.Provider>
}
