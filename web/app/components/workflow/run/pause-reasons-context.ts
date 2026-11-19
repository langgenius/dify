import type { WorkflowPausedResponse } from '@/types/workflow'
import { createContext } from 'react'

export const WorkflowPauseReasonsContext = createContext<
  WorkflowPausedResponse['data']['reasons'] | undefined
>(undefined)
