import type { StateCreator } from 'zustand'
import type { SliceFromInjection } from './store'
import {
  createContext,
  useRef,
} from 'react'
import {
  createWorkflowStore,
} from './store'

type WorkflowStore = ReturnType<typeof createWorkflowStore>
export const WorkflowContext = createContext<WorkflowStore | null>(null)

export type WorkflowProviderProps = {
  children: React.ReactNode
  injectWorkflowStoreSliceFn?: StateCreator<SliceFromInjection>
}
export const WorkflowContextProvider = ({ children, injectWorkflowStoreSliceFn }: WorkflowProviderProps) => {
  const storeRef = useRef<WorkflowStore | undefined>(undefined)

  if (!storeRef.current)
    storeRef.current = createWorkflowStore({ injectWorkflowStoreSliceFn })

  return (
    <WorkflowContext.Provider value={storeRef.current}>
      {children}
    </WorkflowContext.Provider>
  )
}
