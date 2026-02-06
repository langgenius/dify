import type { Node, NodeOutPutVar } from '@/app/components/workflow/types'
import { createContext, useContext } from 'react'

type ToolBlockContextValue = {
  metadata?: Record<string, unknown>
  onMetadataChange?: (metadata: Record<string, unknown>) => void
  useModal?: boolean
  nodeId?: string
  nodesOutputVars?: NodeOutPutVar[]
  availableNodes?: Node[]
}

const ToolBlockContext = createContext<ToolBlockContextValue | null>(null)

export const ToolBlockContextProvider = ToolBlockContext.Provider

export const useToolBlockContext = () => useContext(ToolBlockContext)
