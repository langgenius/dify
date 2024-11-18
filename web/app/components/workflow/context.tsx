import {
  createContext,
  useRef,
} from 'react'
import { createWorkflowStore } from './store'

type WorkflowStore = ReturnType<typeof createWorkflowStore>
export const WorkflowContext = createContext<WorkflowStore | null>(null)

type WorkflowProviderProps = {
  children: React.ReactNode
}
export const WorkflowContextProvider = ({ children }: WorkflowProviderProps) => {
  const storeRef = useRef<WorkflowStore>()

  if (!storeRef.current)
    storeRef.current = createWorkflowStore()

  return (
    <WorkflowContext.Provider value={storeRef.current}>
      {children}
    </WorkflowContext.Provider>
  )
}
