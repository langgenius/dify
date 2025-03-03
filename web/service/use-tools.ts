import { get, post } from './base'
import type {
  Collection,
  Tool,
} from '@/app/components/tools/types'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import { useInvalid } from './use-base'
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'

const NAME_SPACE = 'tools'

const useAllToolProvidersKey = [NAME_SPACE, 'allToolProviders']
export const useAllToolProviders = () => {
  return useQuery<Collection[]>({
    queryKey: useAllToolProvidersKey,
    queryFn: () => get<Collection[]>('/workspaces/current/tool-providers'),
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
