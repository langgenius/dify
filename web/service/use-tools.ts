import { del, get, post, put } from './base'
import type {
  Collection,
  MCPServerDetail,
  Tool,
} from '@/app/components/tools/types'
import { CollectionType } from '@/app/components/tools/types'
import type { RAGRecommendedPlugins, ToolWithProvider } from '@/app/components/workflow/types'
import type { AppIconType } from '@/types/app'
import { useInvalid } from './use-base'
import type { QueryKey } from '@tanstack/react-query'
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'

const NAME_SPACE = 'tools'

const useAllToolProvidersKey = [NAME_SPACE, 'allToolProviders']
export const useAllToolProviders = (enabled = true) => {
  return useQuery<Collection[]>({
    queryKey: useAllToolProvidersKey,
    queryFn: () => get<Collection[]>('/workspaces/current/tool-providers'),
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
    queryFn: () => get<ToolWithProvider[]>('/workspaces/current/tools/builtin'),
  })
}

export const useInvalidateAllBuiltInTools = () => {
  return useInvalid(useAllBuiltInToolsKey)
}

const useAllCustomToolsKey = [NAME_SPACE, 'customTools']
export const useAllCustomTools = () => {
  return useQuery<ToolWithProvider[]>({
    queryKey: useAllCustomToolsKey,
    queryFn: () => get<ToolWithProvider[]>('/workspaces/current/tools/api'),
  })
}

export const useInvalidateAllCustomTools = () => {
  return useInvalid(useAllCustomToolsKey)
}

const useAllWorkflowToolsKey = [NAME_SPACE, 'workflowTools']
export const useAllWorkflowTools = () => {
  return useQuery<ToolWithProvider[]>({
    queryKey: useAllWorkflowToolsKey,
    queryFn: () => get<ToolWithProvider[]>('/workspaces/current/tools/workflow'),
  })
}

export const useInvalidateAllWorkflowTools = () => {
  return useInvalid(useAllWorkflowToolsKey)
}

const useAllMCPToolsKey = [NAME_SPACE, 'MCPTools']
export const useAllMCPTools = () => {
  return useQuery<ToolWithProvider[]>({
    queryKey: useAllMCPToolsKey,
    queryFn: () => get<ToolWithProvider[]>('/workspaces/current/tools/mcp'),
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
export const useInvalidToolsByType = (type: CollectionType | string) => {
  return useInvalid(useInvalidToolsKeyMap[type])
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
      return post<ToolWithProvider>('workspaces/current/tool-provider/mcp', {
        body: {
          ...payload,
        },
      })
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
      return put('workspaces/current/tool-provider/mcp', {
        body: {
          ...payload,
        },
      })
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
      return del('/workspaces/current/tool-provider/mcp', {
        body: {
          provider_id: id,
        },
      })
    },
    onSuccess,
  })
}

export const useAuthorizeMCP = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'authorize-mcp'],
    mutationFn: (payload: { provider_id: string; }) => {
      return post<{ result?: string; authorization_url?: string }>('/workspaces/current/tool-provider/mcp/auth', {
        body: payload,
      })
    },
  })
}

export const useUpdateMCPAuthorizationToken = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'refresh-mcp-server-code'],
    mutationFn: (payload: { provider_id: string; authorization_code: string }) => {
      return get<MCPServerDetail>('/workspaces/current/tool-provider/mcp/token', {
        params: {
          ...payload,
        },
      })
    },
  })
}

export const useMCPTools = (providerID: string) => {
  return useQuery({
    enabled: !!providerID,
    queryKey: [NAME_SPACE, 'get-MCP-provider-tool', providerID],
    queryFn: () => get<{ tools: Tool[] }>(`/workspaces/current/tool-provider/mcp/tools/${providerID}`),
  })
}
export const useInvalidateMCPTools = () => {
  const queryClient = useQueryClient()
  return (providerID: string) => {
    queryClient.invalidateQueries(
      {
        queryKey: [NAME_SPACE, 'get-MCP-provider-tool', providerID],
      })
  }
}

export const useUpdateMCPTools = () => {
  return useMutation({
    mutationFn: (providerID: string) => get<{ tools: Tool[] }>(`/workspaces/current/tool-provider/mcp/update/${providerID}`),
  })
}

export const useMCPServerDetail = (appID: string) => {
  return useQuery<MCPServerDetail>({
    queryKey: [NAME_SPACE, 'MCPServerDetail', appID],
    queryFn: () => get<MCPServerDetail>(`/apps/${appID}/server`),
  })
}

export const useInvalidateMCPServerDetail = () => {
  const queryClient = useQueryClient()
  return (appID: string) => {
    queryClient.invalidateQueries(
      {
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
      parameters?: Record<string, string>
    }) => {
      const { appID, ...rest } = payload
      return post(`apps/${appID}/server`, {
        body: {
          ...rest,
        },
      })
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
      const { appID, ...rest } = payload
      return put(`apps/${appID}/server`, {
        body: {
          ...rest,
        },
      })
    },
  })
}

export const useRefreshMCPServerCode = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'refresh-mcp-server-code'],
    mutationFn: (appID: string) => {
      return get<MCPServerDetail>(`apps/${appID}/server/refresh`)
    },
  })
}

export const useBuiltinProviderInfo = (providerName: string) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'builtin-provider-info', providerName],
    queryFn: () => get<Collection>(`/workspaces/current/tool-provider/builtin/${providerName}/info`),
  })
}

export const useInvalidateBuiltinProviderInfo = () => {
  const queryClient = useQueryClient()
  return (providerName: string) => {
    queryClient.invalidateQueries(
      {
        queryKey: [NAME_SPACE, 'builtin-provider-info', providerName],
      })
  }
}

export const useBuiltinTools = (providerName: string) => {
  return useQuery({
    enabled: !!providerName,
    queryKey: [NAME_SPACE, 'builtin-provider-tools', providerName],
    queryFn: () => get<Tool[]>(`/workspaces/current/tool-provider/builtin/${providerName}/tools`),
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
      const { providerName, credentials } = payload
      return post(`/workspaces/current/tool-provider/builtin/${providerName}/update`, {
        body: {
          credentials,
        },
      })
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
      return post(`/workspaces/current/tool-provider/builtin/${providerName}/delete`, {
        body: {},
      })
    },
    onSuccess,
  })
}

const useRAGRecommendedPluginListKey = [NAME_SPACE, 'rag-recommended-plugins']

export const useRAGRecommendedPlugins = () => {
  return useQuery<RAGRecommendedPlugins>({
    queryKey: useRAGRecommendedPluginListKey,
    queryFn: () => get<RAGRecommendedPlugins>('/rag/pipelines/recommended-plugins'),
  })
}

export const useInvalidateRAGRecommendedPlugins = () => {
  return useInvalid(useRAGRecommendedPluginListKey)
}
