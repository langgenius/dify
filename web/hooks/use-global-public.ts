import type { SystemFeatures } from '@/types/feature'
import { useQuery } from '@tanstack/react-query'
import { consoleClient, consoleQuery } from '@/service/client'
import { defaultSystemFeatures } from '@/types/feature'
import { fetchSetupStatusWithCache } from '@/utils/setup-status'

export function useSystemFeaturesQuery() {
  return useQuery({
    queryKey: consoleQuery.systemFeatures.queryKey(),
    queryFn: () => consoleClient.systemFeatures(),
  })
}

export function useSystemFeatures(): SystemFeatures {
  const { data } = useSystemFeaturesQuery()
  return { ...defaultSystemFeatures, ...data }
}

export function useIsSystemFeaturesPending() {
  const { isPending } = useSystemFeaturesQuery()
  return isPending
}

export function useSetupStatusQuery() {
  return useQuery({
    queryKey: consoleQuery.setupStatus.queryKey(),
    queryFn: fetchSetupStatusWithCache,
    staleTime: Infinity,
  })
}
