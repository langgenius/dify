import type { StateCreator } from 'zustand'
import type {
  ToolWithProvider,
} from '@/app/components/workflow/types'

export type ToolSliceShape = {
  buildInTools: ToolWithProvider[]
  setBuildInTools: (tools: ToolWithProvider[]) => void
  customTools: ToolWithProvider[]
  setCustomTools: (tools: ToolWithProvider[]) => void
  workflowTools: ToolWithProvider[]
  setWorkflowTools: (tools: ToolWithProvider[]) => void
  mcpTools: ToolWithProvider[]
  setMcpTools: (tools: ToolWithProvider[]) => void
  toolPublished: boolean
  setToolPublished: (toolPublished: boolean) => void
}

export const createToolSlice: StateCreator<ToolSliceShape> = set => ({
  buildInTools: [],
  setBuildInTools: buildInTools => set(() => ({ buildInTools })),
  customTools: [],
  setCustomTools: customTools => set(() => ({ customTools })),
  workflowTools: [],
  setWorkflowTools: workflowTools => set(() => ({ workflowTools })),
  mcpTools: [],
  setMcpTools: mcpTools => set(() => ({ mcpTools })),
  toolPublished: false,
  setToolPublished: toolPublished => set(() => ({ toolPublished })),
})
