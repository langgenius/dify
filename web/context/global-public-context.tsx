'use client'
import type { FC, PropsWithChildren } from 'react'
import type { SystemFeatures } from '@/types/feature'
import { useQuery } from '@tanstack/react-query'
import { create } from 'zustand'
import Loading from '@/app/components/base/loading'
import { consoleClient } from '@/service/client'
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
const setupStatusQueryKey = ['setupStatus'] as const

async function fetchSystemFeatures() {
  const resp = await consoleClient.systemFeatures() as Record<string, unknown>
  let features = { ...defaultSystemFeatures }
  try {
    // Support both the new Base64 envelope ({ d: string }) and the legacy plain
    // JSON shape so the frontend degrades gracefully during a rolling deploy or
    // backend rollback.
    const jsonText = typeof resp?.d === 'string'
      ? new TextDecoder().decode(Uint8Array.from(atob(resp.d), c => c.charCodeAt(0)))
      : JSON.stringify(resp) // legacy: backend returns plain SystemFeatures JSON
    features = { ...defaultSystemFeatures, ...(JSON.parse(jsonText) as Partial<SystemFeatures>) }
  }
  catch (error) {
    // Base64 decode or JSON.parse failed; fall back to safe defaults
    console.error('[system-features] Failed to decode response envelope; using defaults', error)
  }
  const { setSystemFeatures } = useGlobalPublicStore.getState()
  setSystemFeatures(features)
  return features
}

export function useSystemFeaturesQuery() {
  return useQuery({
    queryKey: systemFeaturesQueryKey,
    queryFn: fetchSystemFeatures,
  })
}

export function useIsSystemFeaturesPending() {
  const { isPending } = useSystemFeaturesQuery()
  return isPending
}

export function useSetupStatusQuery() {
  return useQuery({
    queryKey: setupStatusQueryKey,
    queryFn: fetchSetupStatusWithCache,
    staleTime: Infinity,
  })
}

const GlobalPublicStoreProvider: FC<PropsWithChildren> = ({
  children,
}) => {
  // Fetch systemFeatures and setupStatus in parallel to reduce waterfall.
  // setupStatus is prefetched here and cached in localStorage for AppInitializer.
  const { isPending } = useSystemFeaturesQuery()

  // Prefetch setupStatus for AppInitializer (result not needed here)
  useSetupStatusQuery()

  if (isPending)
    return <div className="flex h-screen w-screen items-center justify-center"><Loading /></div>
  return <>{children}</>
}
export default GlobalPublicStoreProvider
