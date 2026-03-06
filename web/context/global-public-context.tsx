'use client'
import type { FC, PropsWithChildren } from 'react'
import type { SystemFeatures } from '@/types/feature'
import { useQuery } from '@tanstack/react-query'
import { create } from 'zustand'
import Loading from '@/app/components/base/loading'
import { consoleClient } from '@/service/client'
import { defaultSystemFeatures, systemFeaturesSchema } from '@/types/feature'
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
  const envelope = await consoleClient.systemFeatures()
  let decoded: SystemFeatures
  try {
    // Decode Base64 via TextDecoder so the payload is UTF-8-safe regardless of
    // whether the backend uses ensure_ascii=True or not.
    const jsonText = new TextDecoder().decode(
      Uint8Array.from(atob(envelope.d), c => c.charCodeAt(0)),
    )
    const parsed = systemFeaturesSchema.parse(JSON.parse(jsonText))
    decoded = parsed
  }
  catch (error) {
    // Decode or validation failed; fall back to safe defaults
    console.error('[system-features] Failed to decode response envelope; using defaults', error)
    decoded = { ...defaultSystemFeatures }
  }
  const resolvedFeatures = { ...defaultSystemFeatures, ...decoded }
  const { setSystemFeatures } = useGlobalPublicStore.getState()
  setSystemFeatures(resolvedFeatures)
  return resolvedFeatures
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
