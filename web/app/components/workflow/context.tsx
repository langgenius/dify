import type { StateCreator } from 'zustand'
import type { SliceFromInjection } from './store/workflow'
import { createContext, useState } from 'react'
import { createWorkflowStore } from './store/workflow'

type WorkflowStore = ReturnType<typeof createWorkflowStore>
export const WorkflowContext = createContext<WorkflowStore | null>(null)

type WorkflowProviderProps = {
  children: React.ReactNode
  injectWorkflowStoreSliceFn?: StateCreator<SliceFromInjection>
}
export const WorkflowContextProvider = ({
  children,
  injectWorkflowStoreSliceFn,
}: WorkflowProviderProps) => {
  const [store] = useState(() => createWorkflowStore({ injectWorkflowStoreSliceFn }))

  return <WorkflowContext.Provider value={store}>{children}</WorkflowContext.Provider>
}
