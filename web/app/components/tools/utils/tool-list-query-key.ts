import type { CollectionProviderType } from '../types'
import { consoleQuery } from '@/service/console'
import { CollectionType } from '../types'

// Each provider type is listed by its own console operation; other provider types have no list.
export const getToolListQueryKey = (type?: CollectionProviderType) => {
  const tools = consoleQuery.workspaces.current.tools
  switch (type) {
    case CollectionType.builtIn:
      return tools.builtin.get.queryKey()
    case CollectionType.custom:
      return tools.api.get.queryKey()
    case CollectionType.workflow:
      return tools.workflow.get.queryKey()
    case CollectionType.mcp:
      return tools.mcp.get.queryKey()
    default:
      return undefined
  }
}
