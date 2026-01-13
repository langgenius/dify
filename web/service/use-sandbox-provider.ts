import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { del, get, post } from './base'

const NAME_SPACE = 'sandbox-provider'

export const sandboxProviderQueryKeys = {
  all: [NAME_SPACE] as const,
  list: [NAME_SPACE, 'list'] as const,
  provider: (providerType: string) => [NAME_SPACE, 'provider', providerType] as const,
  active: [NAME_SPACE, 'active'] as const,
}

export type ConfigSchema = {
  name: string
  type: string
}

export type SandboxProvider = {
  provider_type: string
  label: string
  description: string
  icon: string
  is_system_configured: boolean
  is_tenant_configured: boolean
  is_active: boolean
  config: Record<string, string>
  config_schema: ConfigSchema[]
}

export const useGetSandboxProviderList = () => {
  return useQuery({
    queryKey: sandboxProviderQueryKeys.list,
    queryFn: () => get<SandboxProvider[]>('/workspaces/current/sandbox-providers'),
    retry: 0,
  })
}

export const useGetSandboxProvider = (providerType: string) => {
  return useQuery({
    queryKey: sandboxProviderQueryKeys.provider(providerType),
    queryFn: () => get<SandboxProvider>(`/workspaces/current/sandbox-provider/${providerType}`),
    retry: 0,
    enabled: !!providerType,
  })
}

export const useSaveSandboxProviderConfig = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: [NAME_SPACE, 'save-config'],
    mutationFn: ({ providerType, config }: { providerType: string, config: Record<string, string> }) => {
      return post<{ result: string }>(`/workspaces/current/sandbox-provider/${providerType}/config`, {
        body: { config },
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sandboxProviderQueryKeys.list })
    },
  })
}

export const useDeleteSandboxProviderConfig = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: [NAME_SPACE, 'delete-config'],
    mutationFn: (providerType: string) => {
      return del<{ result: string }>(`/workspaces/current/sandbox-provider/${providerType}/config`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sandboxProviderQueryKeys.list })
    },
  })
}

export const useActivateSandboxProvider = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: [NAME_SPACE, 'activate'],
    mutationFn: (providerType: string) => {
      return post<{ result: string }>(`/workspaces/current/sandbox-provider/${providerType}/activate`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sandboxProviderQueryKeys.list })
    },
  })
}

export const useGetActiveSandboxProvider = () => {
  return useQuery({
    queryKey: sandboxProviderQueryKeys.active,
    queryFn: () => get<{ provider_type: string | null }>('/workspaces/current/sandbox-provider/active'),
    retry: 0,
  })
}
