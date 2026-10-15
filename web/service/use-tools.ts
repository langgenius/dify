import type { AppMcpServerStatus } from '@dify/contracts/api/console/apps/types.gen'
import type { QueryKey, UseQueryOptions } from '@tanstack/react-query'
import type {
  Collection,
  CollectionProviderType,
  MCPServerDetail,
  Tool,
  WorkflowToolProviderResponse,
} from '@/app/components/tools/types'
import type { RAGRecommendedPlugins, ToolWithProvider } from '@/app/components/workflow/types'
import type { AppIconType } from '@/types/app'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CollectionType } from '@/app/components/tools/types'
import { consoleClient } from '@/service/console'
import { narrowResponse } from './console/narrow-response'
import { useInvalid } from './use-base'

const NAME_SPACE = 'tools'

const useAllToolProvidersKey = [NAME_SPACE, 'allToolProviders']
type ToolProviderListType = 'builtin' | 'model' | 'api' | 'workflow' | 'mcp'

export const useAllToolProviders = (enabled = true, type?: ToolProviderListType) => {
  return useQuery<Collection[]>({
    queryKey: type ? [...useAllToolProvidersKey, type] : useAllToolProvidersKey,
    queryFn: () =>
      narrowResponse<Collection[]>(
        consoleClient.workspaces.current.toolProviders.get({ query: type ? { type } : {} }),
      ),
    enabled,
  })
}

export const useInvalidateAllToolProviders = () => {
  return useInvalid(useAllToolProvidersKey)
}

const useAllBuiltInToolsKey = [NAME_SPACE, 'builtIn']
export const useAllBuiltInTools = (enabled = true) => {
  return useQuery<ToolWithProvider[]>({
    queryKey: useAllBuiltInToolsKey,
    queryFn: () =>
      narrowResponse<ToolWithProvider[]>(consoleClient.workspaces.current.tools.builtin.get()),
    enabled,
  })
}

export const useInvalidateAllBuiltInTools = () => {
  return useInvalid(useAllBuiltInToolsKey)
}

const useAllCustomToolsKey = [NAME_SPACE, 'customTools']
export const useAllCustomTools = (enabled = true) => {
  return useQuery<ToolWithProvider[]>({
    queryKey: useAllCustomToolsKey,
    queryFn: () =>
      narrowResponse<ToolWithProvider[]>(consoleClient.workspaces.current.tools.api.get()),
    enabled,
  })
}

export const useInvalidateAllCustomTools = () => {
  return useInvalid(useAllCustomToolsKey)
}

const useAllWorkflowToolsKey = [NAME_SPACE, 'workflowTools']
export const useAllWorkflowTools = (enabled = true) => {
  return useQuery<ToolWithProvider[]>({
    queryKey: useAllWorkflowToolsKey,
    queryFn: () =>
      narrowResponse<ToolWithProvider[]>(consoleClient.workspaces.current.tools.workflow.get()),
    enabled,
  })
}

export const useInvalidateAllWorkflowTools = () => {
  return useInvalid(useAllWorkflowToolsKey)
}

const useAllMCPToolsKey = [NAME_SPACE, 'MCPTools']
export const useAllMCPTools = (enabled = true) => {
  return useQuery<ToolWithProvider[]>({
    queryKey: useAllMCPToolsKey,
    queryFn: () =>
      narrowResponse<ToolWithProvider[]>(consoleClient.workspaces.current.tools.mcp.get()),
    enabled,
  })
}

export const useInvalidateAllMCPTools = () => {
  return useInvalid(useAllMCPToolsKey)
}

const useInvalidToolsKeyMap: Partial<Record<CollectionProviderType, QueryKey>> = {
  [CollectionType.builtIn]: useAllBuiltInToolsKey,
  [CollectionType.custom]: useAllCustomToolsKey,
  [CollectionType.workflow]: useAllWorkflowToolsKey,
  [CollectionType.mcp]: useAllMCPToolsKey,
}
export const useInvalidToolsByType = (type?: CollectionProviderType) => {
  const queryKey = type ? useInvalidToolsKeyMap[type] : undefined
  return useInvalid(queryKey)
}

export const useCreateMCP = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'create-mcp'],
    mutationFn: (payload: {
      name: string
      server_url: string
      server_identifier: string
      icon_type: AppIconType
      icon: string
      icon_background?: string
      timeout?: number
      sse_read_timeout?: number
      headers?: Record<string, string>
      identity_mode?: 'off' | 'idp_token'
    }) => {
      return narrowResponse<ToolWithProvider>(
        consoleClient.workspaces.current.toolProvider.mcp.post({ body: { ...payload } }),
      )
    },
  })
}

export const useUpdateMCP = ({ onSuccess }: { onSuccess?: () => void }) => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'update-mcp'],
    mutationFn: (payload: {
      name: string
      server_url: string
      server_identifier: string
      icon_type: AppIconType
      icon: string
      icon_background?: string
      provider_id: string
      timeout?: number
      sse_read_timeout?: number
      headers?: Record<string, string>
      identity_mode?: 'off' | 'idp_token'
    }) => {
      return consoleClient.workspaces.current.toolProvider.mcp.put({ body: { ...payload } })
    },
    onSuccess,
  })
}

export const useDeleteMCP = ({ onSuccess }: { onSuccess?: () => void }) => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'delete-mcp'],
    mutationFn: (id: string) => {
      return consoleClient.workspaces.current.toolProvider.mcp.delete({ body: { provider_id: id } })
    },
    onSuccess,
  })
}

export const useAuthorizeMCP = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'authorize-mcp'],
    mutationFn: (payload: { provider_id: string }) => {
      return consoleClient.workspaces.current.toolProvider.mcp.auth.post({ body: payload })
    },
  })
}

export const useMCPTools = (providerID: string) => {
  return useQuery({
    enabled: !!providerID,
    queryKey: [NAME_SPACE, 'get-MCP-provider-tool', providerID],
    queryFn: () =>
      narrowResponse<{ tools: Tool[] }>(
        consoleClient.workspaces.current.toolProvider.mcp.tools.byProviderId.get({
          params: { provider_id: providerID },
        }),
      ),
  })
}
export const useInvalidateMCPTools = () => {
  const queryClient = useQueryClient()
  return (providerID: string) => {
    queryClient.invalidateQueries({
      queryKey: [NAME_SPACE, 'get-MCP-provider-tool', providerID],
    })
  }
}

export const useUpdateMCPTools = () => {
  return useMutation({
    mutationFn: (providerID: string) =>
      narrowResponse<{ tools: Tool[] }>(
        consoleClient.workspaces.current.toolProvider.mcp.update.byProviderId.get({
          params: { provider_id: providerID },
        }),
      ),
  })
}

export const useMCPServerDetail = (appID: string, enabled = true) => {
  return useQuery<MCPServerDetail>({
    queryKey: [NAME_SPACE, 'MCPServerDetail', appID],
    queryFn: () =>
      narrowResponse<MCPServerDetail>(
        consoleClient.apps.byAppId.server.get({ params: { app_id: appID } }),
      ),
    enabled,
  })
}

export const useInvalidateMCPServerDetail = () => {
  const queryClient = useQueryClient()
  return (appID: string) => {
    return queryClient.invalidateQueries({
      queryKey: [NAME_SPACE, 'MCPServerDetail', appID],
    })
  }
}

export const useCreateMCPServer = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'create-mcp-server'],
    mutationFn: (payload: {
      appID: string
      description?: string
      parameters: Record<string, string>
    }) => {
      const { appID, ...rest } = payload
      return consoleClient.apps.byAppId.server.post({ params: { app_id: appID }, body: rest })
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
      status?: AppMcpServerStatus
      parameters: Record<string, string>
    }) => {
      const { appID, ...rest } = payload
      return consoleClient.apps.byAppId.server.put({ params: { app_id: appID }, body: rest })
    },
  })
}

export const useRefreshMCPServerCode = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'refresh-mcp-server-code'],
    mutationFn: (appID: string) => {
      return consoleClient.apps.byAppId.server.refresh.post({
        params: {
          app_id: appID,
        },
      })
    },
  })
}

export const useBuiltinTools = (providerName: string) => {
  return useQuery({
    enabled: !!providerName,
    queryKey: [NAME_SPACE, 'builtin-provider-tools', providerName],
    queryFn: () =>
      narrowResponse<Tool[]>(
        consoleClient.workspaces.current.toolProvider.builtin.byProvider.tools.get({
          params: { provider: providerName },
        }),
      ),
  })
}

const useRAGRecommendedPluginListKey = [NAME_SPACE, 'rag-recommended-plugins']

export const useRAGRecommendedPlugins = (type: 'tool' | 'datasource' | 'all' = 'all') => {
  return useQuery<RAGRecommendedPlugins>({
    queryKey: [...useRAGRecommendedPluginListKey, type],
    queryFn: () =>
      narrowResponse<RAGRecommendedPlugins>(
        consoleClient.rag.pipelines.recommendedPlugins.get({ query: { type } }),
      ),
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
export type AppTrigger = {
  id: string
  trigger_type: 'trigger-webhook' | 'trigger-schedule' | 'trigger-plugin'
  title: string
  node_id: string
  provider_name: string
  icon: string
  status: 'enabled' | 'disabled' | 'unauthorized'
  created_at: string
  updated_at: string
}

export const useAppTriggers = (
  appId: string | undefined,
  options?: Omit<UseQueryOptions<{ data: AppTrigger[] }>, 'queryKey' | 'queryFn'>,
) => {
  return useQuery<{ data: AppTrigger[] }>({
    queryKey: [NAME_SPACE, 'app-triggers', appId],
    queryFn: () =>
      narrowResponse<{ data: AppTrigger[] }>(
        consoleClient.apps.byAppId.triggers.get({ params: { app_id: appId! } }),
      ),
    enabled: !!appId,
    ...options, // Merge additional options while maintaining backward compatibility
  })
}

export const useInvalidateAppTriggers = () => {
  const queryClient = useQueryClient()
  return (appId: string) => {
    return queryClient.invalidateQueries({
      queryKey: [NAME_SPACE, 'app-triggers', appId],
    })
  }
}

const workflowToolDetailByAppIDKey = (appId: string) => [
  NAME_SPACE,
  'workflowToolDetailByAppID',
  appId,
]

export const useWorkflowToolDetailByAppID = (appId: string, enabled = true) => {
  return useQuery<WorkflowToolProviderResponse>({
    queryKey: workflowToolDetailByAppIDKey(appId),
    queryFn: () =>
      narrowResponse<WorkflowToolProviderResponse>(
        consoleClient.workspaces.current.toolProvider.workflow.get.get({
          query: { workflow_app_id: appId },
        }),
      ),
    enabled: enabled && !!appId,
  })
}

export const useInvalidateWorkflowToolDetailByAppID = () => {
  const queryClient = useQueryClient()
  return (appId: string) => {
    queryClient.invalidateQueries({
      queryKey: workflowToolDetailByAppIDKey(appId),
    })
  }
}
