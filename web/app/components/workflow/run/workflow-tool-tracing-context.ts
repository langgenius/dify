import type { NodeTracing } from '@/types/workflow'
import { createContext } from 'react'

export type WorkflowRunScope = {
  appId: string
  runId: string
  status?: string
}

export const WorkflowToolTracingContext = createContext<{
  workflowRun: WorkflowRunScope
  onShowWorkflowTool: (node: NodeTracing) => void
} | null>(null)
