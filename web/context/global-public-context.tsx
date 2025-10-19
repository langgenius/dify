'use client'
import { create } from 'zustand'
import { useQuery } from '@tanstack/react-query'
import type { FC, PropsWithChildren } from 'react'
import { useEffect } from 'react'
import type { SystemFeatures } from '@/types/feature'
import { defaultSystemFeatures } from '@/types/feature'
import { getSystemFeatures } from '@/service/common'
import Loading from '@/app/components/base/loading'

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
  const { isPending, data } = useQuery({
    queryKey: ['systemFeatures'],
    queryFn: getSystemFeatures,
  })
  const { setSystemFeatures, setIsGlobalPending: setIsPending } = useGlobalPublicStore()
  useEffect(() => {
    if (data)
      setSystemFeatures({ ...defaultSystemFeatures, ...data })
  }, [data, setSystemFeatures])

  useEffect(() => {
    setIsPending(isPending)
  }, [isPending, setIsPending])

  if (isPending)
    return <div className='flex h-screen w-screen items-center justify-center'><Loading /></div>
  return <>{children}</>
}
export default GlobalPublicStoreProvider
