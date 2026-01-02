import type { QueryKey } from '@tanstack/react-query'
import type { AppTrigger } from './tools'
import type {
  Collection,
  MCPServerDetail,
  Tool,
} from '@/app/components/tools/types'
import type { RAGRecommendedPlugins, ToolWithProvider } from '@/app/components/workflow/types'
import type { AppIconType } from '@/types/app'
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { CollectionType } from '@/app/components/tools/types'
import {
  authorizeMCPProvider,
  createMCPProvider,
  createMCPServer,
  deleteMCPProvider,
  fetchAllBuiltInTools,
  fetchAllCustomTools,
  fetchAllMCPTools,
  fetchAllWorkflowTools,
  fetchAppTriggers,
  fetchBuiltinProviderInfo,
  fetchBuiltinProviderTools,
  fetchCollectionList,
  fetchMCPProviderToken,
  fetchMCPProviderTools,
  fetchMCPServerDetail,
  fetchRAGRecommendedPlugins,
  refreshMCPServerCode,
  removeBuiltinProviderCredentials,
  updateAppTriggerStatus,
  updateBuiltinProviderCredentials,
  updateMCPProvider,
  updateMCPProviderTools,
  updateMCPServer,
} from './tools'
import { useInvalid } from './use-base'

const NAME_SPACE = 'tools'

const useAllToolProvidersKey = [NAME_SPACE, 'allToolProviders']
export const useAllToolProviders = (enabled = true) => {
  return useQuery<Collection[]>({
    queryKey: useAllToolProvidersKey,
    queryFn: () => fetchCollectionList(),
    enabled,
  })
}

export const useInvalidateAllToolProviders = () => {
  return useInvalid(useAllToolProvidersKey)
}

const useAllBuiltInToolsKey = [NAME_SPACE, 'builtIn']
export const useAllBuiltInTools = () => {
  return useQuery<ToolWithProvider[]>({
    queryKey: useAllBuiltInToolsKey,
    queryFn: () => fetchAllBuiltInTools(),
  })
}

export const useInvalidateAllBuiltInTools = () => {
  return useInvalid(useAllBuiltInToolsKey)
}

const useAllCustomToolsKey = [NAME_SPACE, 'customTools']
export const useAllCustomTools = () => {
  return useQuery<ToolWithProvider[]>({
    queryKey: useAllCustomToolsKey,
    queryFn: () => fetchAllCustomTools(),
  })
}

export const useInvalidateAllCustomTools = () => {
  return useInvalid(useAllCustomToolsKey)
}

const useAllWorkflowToolsKey = [NAME_SPACE, 'workflowTools']
export const useAllWorkflowTools = () => {
  return useQuery<ToolWithProvider[]>({
    queryKey: useAllWorkflowToolsKey,
    queryFn: () => fetchAllWorkflowTools(),
  })
}

export const useInvalidateAllWorkflowTools = () => {
  return useInvalid(useAllWorkflowToolsKey)
}

const useAllMCPToolsKey = [NAME_SPACE, 'MCPTools']
export const useAllMCPTools = () => {
  return useQuery<ToolWithProvider[]>({
    queryKey: useAllMCPToolsKey,
    queryFn: () => fetchAllMCPTools(),
  })
}

export const useInvalidateAllMCPTools = () => {
  return useInvalid(useAllMCPToolsKey)
}

const useInvalidToolsKeyMap: Record<string, QueryKey> = {
  [CollectionType.builtIn]: useAllBuiltInToolsKey,
  [CollectionType.custom]: useAllCustomToolsKey,
  [CollectionType.workflow]: useAllWorkflowToolsKey,
  [CollectionType.mcp]: useAllMCPToolsKey,
}
export const useInvalidToolsByType = (type?: CollectionType | string) => {
  const queryKey = type ? useInvalidToolsKeyMap[type] : undefined
  return useInvalid(queryKey)
}

export const useCreateMCP = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'create-mcp'],
    mutationFn: (payload: {
      name: string
      server_url: string
      icon_type: AppIconType
      icon: string
      icon_background?: string | null
      timeout?: number
      sse_read_timeout?: number
      headers?: Record<string, string>
    }) => {
      return createMCPProvider(payload)
    },
  })
}

export const useUpdateMCP = ({
  onSuccess,
}: {
  onSuccess?: () => void
}) => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'update-mcp'],
    mutationFn: (payload: {
      name: string
      server_url: string
      icon_type: AppIconType
      icon: string
      icon_background?: string | null
      provider_id: string
      timeout?: number
      sse_read_timeout?: number
      headers?: Record<string, string>
    }) => {
      return updateMCPProvider(payload)
    },
    onSuccess,
  })
}

export const useDeleteMCP = ({
  onSuccess,
}: {
  onSuccess?: () => void
}) => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'delete-mcp'],
    mutationFn: (id: string) => {
      return deleteMCPProvider(id)
    },
    onSuccess,
  })
}

export const useAuthorizeMCP = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'authorize-mcp'],
    mutationFn: (payload: { provider_id: string }) => {
      return authorizeMCPProvider(payload)
    },
  })
}

export const useUpdateMCPAuthorizationToken = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'refresh-mcp-server-code'],
    mutationFn: (payload: { provider_id: string, authorization_code: string }) => {
      return fetchMCPProviderToken(payload)
    },
  })
}

export const useMCPTools = (providerID: string) => {
  return useQuery<{ tools: Tool[] }>({
    enabled: !!providerID,
    queryKey: [NAME_SPACE, 'get-MCP-provider-tool', providerID],
    queryFn: () => fetchMCPProviderTools(providerID),
  })
}
export const useInvalidateMCPTools = () => {
  const queryClient = useQueryClient()
  return (providerID: string) => {
    queryClient.invalidateQueries(
      {
        queryKey: [NAME_SPACE, 'get-MCP-provider-tool', providerID],
      },
    )
  }
}

export const useUpdateMCPTools = () => {
  return useMutation({
    mutationFn: (providerID: string) => updateMCPProviderTools(providerID),
  })
}

export const useMCPServerDetail = (appID: string) => {
  return useQuery<MCPServerDetail>({
    queryKey: [NAME_SPACE, 'MCPServerDetail', appID],
    queryFn: () => fetchMCPServerDetail(appID),
  })
}

export const useInvalidateMCPServerDetail = () => {
  const queryClient = useQueryClient()
  return (appID: string) => {
    queryClient.invalidateQueries(
      {
        queryKey: [NAME_SPACE, 'MCPServerDetail', appID],
      },
    )
  }
}

export const useCreateMCPServer = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'create-mcp-server'],
    mutationFn: (payload: {
      appID: string
      description?: string
      parameters?: Record<string, string>
    }) => {
      return createMCPServer(payload)
    },
  })
}

export const useUpdateMCPServer = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'update-mcp-server'],
    mutationFn: (payload: {
      appID: string
      id: string
      description?: string
      status?: string
      parameters?: Record<string, string>
    }) => {
      return updateMCPServer(payload)
    },
  })
}

export const useRefreshMCPServerCode = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'refresh-mcp-server-code'],
    mutationFn: (appID: string) => {
      return refreshMCPServerCode(appID)
    },
  })
}

export const useBuiltinProviderInfo = (providerName: string) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'builtin-provider-info', providerName],
    queryFn: () => fetchBuiltinProviderInfo(providerName),
  })
}

export const useInvalidateBuiltinProviderInfo = () => {
  const queryClient = useQueryClient()
  return (providerName: string) => {
    queryClient.invalidateQueries(
      {
        queryKey: [NAME_SPACE, 'builtin-provider-info', providerName],
      },
    )
  }
}

export const useBuiltinTools = (providerName: string) => {
  return useQuery({
    enabled: !!providerName,
    queryKey: [NAME_SPACE, 'builtin-provider-tools', providerName],
    queryFn: () => fetchBuiltinProviderTools(providerName),
  })
}

export const useUpdateProviderCredentials = ({
  onSuccess,
}: {
  onSuccess?: () => void
}) => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'update-provider-credentials'],
    mutationFn: (payload: { providerName: string, credentials: Record<string, any> }) => {
      return updateBuiltinProviderCredentials(payload)
    },
    onSuccess,
  })
}

export const useRemoveProviderCredentials = ({
  onSuccess,
}: {
  onSuccess?: () => void
}) => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'remove-provider-credentials'],
    mutationFn: (providerName: string) => {
      return removeBuiltinProviderCredentials(providerName)
    },
    onSuccess,
  })
}

const useRAGRecommendedPluginListKey = [NAME_SPACE, 'rag-recommended-plugins']

export const useRAGRecommendedPlugins = (type: 'tool' | 'datasource' | 'all' = 'all') => {
  return useQuery<RAGRecommendedPlugins>({
    queryKey: [...useRAGRecommendedPluginListKey, type],
    queryFn: () => fetchRAGRecommendedPlugins(type),
  })
}

export const useInvalidateRAGRecommendedPlugins = () => {
  const queryClient = useQueryClient()
  return (type: 'tool' | 'datasource' | 'all' = 'all') => {
    queryClient.invalidateQueries({
      queryKey: [...useRAGRecommendedPluginListKey, type],
    })
  }
}

// App Triggers API hooks
export const useAppTriggers = (appId: string | undefined, options?: any) => {
  return useQuery<{ data: AppTrigger[] }>({
    queryKey: [NAME_SPACE, 'app-triggers', appId],
    queryFn: () => fetchAppTriggers(appId || ''),
    enabled: !!appId,
    ...options, // Merge additional options while maintaining backward compatibility
  })
}

export const useInvalidateAppTriggers = () => {
  const queryClient = useQueryClient()
  return (appId: string) => {
    queryClient.invalidateQueries({
      queryKey: [NAME_SPACE, 'app-triggers', appId],
    })
  }
}

export const useUpdateTriggerStatus = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'update-trigger-status'],
    mutationFn: (payload: {
      appId: string
      triggerId: string
      enableTrigger: boolean
    }) => {
      return updateAppTriggerStatus(payload)
    },
  })
}

export type { AppTrigger } from './tools'
