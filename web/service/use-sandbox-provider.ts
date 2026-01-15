import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { consoleClient, consoleQuery } from '@/service/client'

export const useGetSandboxProviderList = () => {
  return useQuery({
    queryKey: consoleQuery.sandboxProvider.getSandboxProviderList.queryKey(),
    queryFn: () => consoleClient.sandboxProvider.getSandboxProviderList(),
  })
}

export const useGetSandboxProvider = (providerType: string) => {
  return useQuery({
    queryKey: consoleQuery.sandboxProvider.getSandboxProvider.queryKey({ input: { params: { providerType } } }),
    queryFn: () => consoleClient.sandboxProvider.getSandboxProvider({ params: { providerType } }),
    enabled: !!providerType,
  })
}

export const useSaveSandboxProviderConfig = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: consoleQuery.sandboxProvider.saveSandboxProviderConfig.mutationKey(),
    mutationFn: ({ providerType, config }: { providerType: string, config: Record<string, string> }) => {
      return consoleClient.sandboxProvider.saveSandboxProviderConfig({
        params: { providerType },
        body: { config },
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: consoleQuery.sandboxProvider.getSandboxProviderList.queryKey() })
    },
  })
}

export const useDeleteSandboxProviderConfig = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: consoleQuery.sandboxProvider.deleteSandboxProviderConfig.mutationKey(),
    mutationFn: (providerType: string) => {
      return consoleClient.sandboxProvider.deleteSandboxProviderConfig({
        params: { providerType },
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: consoleQuery.sandboxProvider.getSandboxProviderList.queryKey() })
    },
  })
}

export const useActivateSandboxProvider = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: consoleQuery.sandboxProvider.activateSandboxProvider.mutationKey(),
    mutationFn: (providerType: string) => {
      return consoleClient.sandboxProvider.activateSandboxProvider({
        params: { providerType },
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: consoleQuery.sandboxProvider.getSandboxProviderList.queryKey() })
    },
  })
}

export const useGetActiveSandboxProvider = () => {
  return useQuery({
    queryKey: consoleQuery.sandboxProvider.getActiveSandboxProvider.queryKey(),
    queryFn: () => consoleClient.sandboxProvider.getActiveSandboxProvider(),
  })
}
