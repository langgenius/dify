import type { ToolNodeType } from '../types'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { CollectionType } from '@/app/components/tools/types'
import { selectToolsWithProvider } from '@/app/components/tools/utils/query-select'
import { consoleQuery } from '@/service/console'
import { matchesProviderReference } from '@/utils/provider-reference'

const useCurrentToolCollection = (
  providerType: ToolNodeType['provider_type'],
  providerId: string,
) => {
  const { data: buildInTools } = useQuery(
    consoleQuery.workspaces.current.tools.builtin.get.queryOptions({
      select: selectToolsWithProvider,
    }),
  )
  const { data: customTools } = useQuery(
    consoleQuery.workspaces.current.tools.api.get.queryOptions({ select: selectToolsWithProvider }),
  )
  const { data: workflowTools } = useQuery(
    consoleQuery.workspaces.current.tools.workflow.get.queryOptions({
      select: selectToolsWithProvider,
    }),
  )
  const { data: mcpTools } = useQuery(
    consoleQuery.workspaces.current.tools.mcp.get.queryOptions({ select: selectToolsWithProvider }),
  )

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
    return currentTools.find((item) => matchesProviderReference(item, providerId))
  }, [currentTools, providerId])

  return {
    currentTools,
    currCollection,
  }
}

export default useCurrentToolCollection
