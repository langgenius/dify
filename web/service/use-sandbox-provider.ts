import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { consoleClient, consoleQuery } from '@/service/client'

export const useGetSandboxProviderList = () => {
  return useQuery({
    queryKey: consoleQuery.getSandboxProviderList.queryKey(),
    queryFn: () => consoleClient.getSandboxProviderList(),
  })
}

export const useGetSandboxProvider = (providerType: string) => {
  return useQuery({
    queryKey: consoleQuery.getSandboxProvider.queryKey({ input: { params: { providerType } } }),
    queryFn: () => consoleClient.getSandboxProvider({ params: { providerType } }),
    enabled: !!providerType,
  })
}

export const useSaveSandboxProviderConfig = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: consoleQuery.saveSandboxProviderConfig.mutationKey(),
    mutationFn: ({ providerType, config }: { providerType: string, config: Record<string, string> }) => {
      return consoleClient.saveSandboxProviderConfig({
        params: { providerType },
        body: { config },
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: consoleQuery.getSandboxProviderList.queryKey() })
    },
  })
}

export const useDeleteSandboxProviderConfig = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: consoleQuery.deleteSandboxProviderConfig.mutationKey(),
    mutationFn: (providerType: string) => {
      return consoleClient.deleteSandboxProviderConfig({
        params: { providerType },
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: consoleQuery.getSandboxProviderList.queryKey() })
    },
  })
}

export const useActivateSandboxProvider = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: consoleQuery.activateSandboxProvider.mutationKey(),
    mutationFn: (providerType: string) => {
      return consoleClient.activateSandboxProvider({
        params: { providerType },
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: consoleQuery.getSandboxProviderList.queryKey() })
    },
  })
}

export const useGetActiveSandboxProvider = () => {
  return useQuery({
    queryKey: consoleQuery.getActiveSandboxProvider.queryKey(),
    queryFn: () => consoleClient.getActiveSandboxProvider(),
  })
}
