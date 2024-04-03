import {
  createContext,
  useRef,
} from 'react'
import { createWorkflowStore } from './store'

type WorkflowStore = ReturnType<typeof createWorkflowStore>
export const WorkflowContext = createContext<WorkflowStore | null>(null)

type WorkflowProviderProps = {
  appId: string
  children: React.ReactNode
}
export const WorkflowContextProvider = ({ appId, children }: WorkflowProviderProps) => {
  const storeRef = useRef<WorkflowStore>()

  if (!storeRef.current)
    storeRef.current = createWorkflowStore(appId)

  return (
    <WorkflowContext.Provider value={storeRef.current}>
      {children}
    </WorkflowContext.Provider>
  )
}
