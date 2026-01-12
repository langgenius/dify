'use client'
import type { FC, PropsWithChildren } from 'react'
import type { SystemFeatures } from '@/types/feature'
import { useQueries, useQuery } from '@tanstack/react-query'
import { create } from 'zustand'
import Loading from '@/app/components/base/loading'
import { getSystemFeatures } from '@/service/common'
import { defaultSystemFeatures } from '@/types/feature'
import { fetchSetupStatusWithCache } from '@/utils/setup-status'

type GlobalPublicStore = {
  systemFeatures: SystemFeatures
  setSystemFeatures: (systemFeatures: SystemFeatures) => void
}

export const useGlobalPublicStore = create<GlobalPublicStore>(set => ({
  systemFeatures: defaultSystemFeatures,
  setSystemFeatures: (systemFeatures: SystemFeatures) => set(() => ({ systemFeatures })),
}))

const systemFeaturesQueryKey = ['systemFeatures'] as const

async function fetchSystemFeatures() {
  const data = await getSystemFeatures()
  const { setSystemFeatures } = useGlobalPublicStore.getState()
  setSystemFeatures({ ...defaultSystemFeatures, ...data })
  return data
}

export function useIsSystemFeaturesPending() {
  const { isPending } = useQuery({
    queryKey: systemFeaturesQueryKey,
    queryFn: fetchSystemFeatures,
  })
  return isPending
}

const GlobalPublicStoreProvider: FC<PropsWithChildren> = ({
  children,
}) => {
  // Fetch systemFeatures and setupStatus in parallel to reduce waterfall.
  // setupStatus is prefetched here and cached in localStorage for AppInitializer.
  // We only destructure featuresQuery since setupStatus result is not used directly.
  const [featuresQuery] = useQueries({
    queries: [
      {
        queryKey: systemFeaturesQueryKey,
        queryFn: fetchSystemFeatures,
      },
      {
        queryKey: ['setupStatus'],
        queryFn: fetchSetupStatusWithCache,
        staleTime: Infinity, // Once fetched, no need to refetch
      },
    ],
  })

  // Only block on systemFeatures, setupStatus is prefetched for AppInitializer
  if (featuresQuery.isPending)
    return <div className="flex h-screen w-screen items-center justify-center"><Loading /></div>
  return <>{children}</>
}
export default GlobalPublicStoreProvider
