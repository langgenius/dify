import {
  useRef,
} from 'react'
import { createWorkflowStore } from './store'
import { createCtx } from '@/utils/context'

type WorkflowStore = ReturnType<typeof createWorkflowStore>
export const [,, WorkflowContext] = createCtx<WorkflowStore>()

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
