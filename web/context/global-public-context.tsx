'use client'
import type { FC, PropsWithChildren } from 'react'
import type { SystemFeatures } from '@/types/feature'
import { useQueries } from '@tanstack/react-query'
import { useEffect } from 'react'
import { create } from 'zustand'
import Loading from '@/app/components/base/loading'
import { getSystemFeatures } from '@/service/common'
import { defaultSystemFeatures } from '@/types/feature'
import { fetchSetupStatusWithCache } from '@/utils/setup-status'

type GlobalPublicStore = {
  isGlobalPending: boolean
  setIsGlobalPending: (isPending: boolean) => void
  systemFeatures: SystemFeatures
  setSystemFeatures: (systemFeatures: SystemFeatures) => void
}

export const useGlobalPublicStore = create<GlobalPublicStore>(set => ({
  isGlobalPending: true,
  setIsGlobalPending: (isPending: boolean) => set(() => ({ isGlobalPending: isPending })),
  systemFeatures: defaultSystemFeatures,
  setSystemFeatures: (systemFeatures: SystemFeatures) => set(() => ({ systemFeatures })),
}))

const GlobalPublicStoreProvider: FC<PropsWithChildren> = ({
  children,
}) => {
  // Fetch systemFeatures and setupStatus in parallel to reduce waterfall
  // setupStatus is cached in localStorage for AppInitializer to read
  const [featuresQuery, _setupStatusQuery] = useQueries({
    queries: [
      {
        queryKey: ['systemFeatures'],
        queryFn: getSystemFeatures,
      },
      {
        queryKey: ['setupStatus'],
        queryFn: fetchSetupStatusWithCache,
        staleTime: Infinity, // Once fetched, no need to refetch
      },
    ],
  })

  const { setSystemFeatures, setIsGlobalPending: setIsPending } = useGlobalPublicStore()

  useEffect(() => {
    if (featuresQuery.data)
      setSystemFeatures({ ...defaultSystemFeatures, ...featuresQuery.data })
  }, [featuresQuery.data, setSystemFeatures])

  useEffect(() => {
    setIsPending(featuresQuery.isPending)
  }, [featuresQuery.isPending, setIsPending])

  // Only block on systemFeatures, setupStatus is prefetched for AppInitializer
  if (featuresQuery.isPending)
    return <div className="flex h-screen w-screen items-center justify-center"><Loading /></div>
  return <>{children}</>
}
export default GlobalPublicStoreProvider
