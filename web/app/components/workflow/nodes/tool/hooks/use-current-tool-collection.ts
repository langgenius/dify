import type { ToolNodeType } from '../types'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import { useMemo } from 'react'
import { CollectionType } from '@/app/components/tools/types'
import {
  useAllBuiltInTools,
  useAllCustomTools,
  useAllMCPTools,
  useAllWorkflowTools,
} from '@/service/use-tools'
import { canFindTool } from '@/utils'

const useCurrentToolCollection = (
  providerType: ToolNodeType['provider_type'],
  providerId: string,
) => {
  const { data: buildInTools } = useAllBuiltInTools()
  const { data: customTools } = useAllCustomTools()
  const { data: workflowTools } = useAllWorkflowTools()
  const { data: mcpTools } = useAllMCPTools()

  const currentTools = useMemo<ToolWithProvider[]>(() => {
    switch (providerType) {
      case CollectionType.builtIn:
        return buildInTools || []
      case CollectionType.custom:
        return customTools || []
      case CollectionType.workflow:
        return workflowTools || []
      case CollectionType.mcp:
        return mcpTools || []
      default:
        return []
    }
  }, [buildInTools, customTools, mcpTools, providerType, workflowTools])

  const currCollection = useMemo(() => {
    return currentTools.find(item => canFindTool(item.id, providerId))
  }, [currentTools, providerId])

  return {
    currentTools,
    currCollection,
  }
}

export default useCurrentToolCollection
