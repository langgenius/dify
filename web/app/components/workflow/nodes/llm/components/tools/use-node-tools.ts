import type { LLMNodeType } from '../../types'
import type { ToolValue } from '@/app/components/workflow/block-selector/types'
import { useNodeCurdKit } from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'

export const useNodeTools = (nodeId: string) => {
  const { handleNodeDataUpdate } = useNodeCurdKit<LLMNodeType>(nodeId)

  const handleToolsChange = (tools: ToolValue[]) => {
    handleNodeDataUpdate({
      tools,
    })
  }
  const handleMaxIterationsChange = (maxIterations: number) => {
    handleNodeDataUpdate({
      max_iterations: maxIterations,
    })
  }

  return {
    handleToolsChange,
    handleMaxIterationsChange,
  }
}
