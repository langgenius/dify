import type { NodeTracing } from '@/types/workflow'
import { createContext } from 'react'

export type WorkflowRunInfo = {
  appId: string
  runId: string
  status?: string
}

export const WorkflowToolTracingContext = createContext<{
  workflowRun: WorkflowRunInfo
  onShowWorkflowTool: (node: NodeTracing) => void
} | null>(null)
