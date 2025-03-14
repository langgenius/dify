'use client'
import { create } from 'zustand'
import { useQuery } from '@tanstack/react-query'
import type { FC, PropsWithChildren } from 'react'
import { useEffect } from 'react'
import type { SystemFeatures } from '@/types/feature'
import { defaultSystemFeatures } from '@/types/feature'
import { getSystemFeatures } from '@/service/common'

type GlobalPublicStore = {
  systemFeatures: SystemFeatures
  setSystemFeatures: (systemFeatures: SystemFeatures) => void
}

export const useGlobalPublicStore = create<GlobalPublicStore>(set => ({
  systemFeatures: defaultSystemFeatures,
  setSystemFeatures: (systemFeatures: SystemFeatures) => set(() => ({ systemFeatures })),
}))

const GlobalPublicStoreProvider: FC<PropsWithChildren> = ({
  children,
}) => {
  const { data } = useQuery({
    queryKey: ['systemFeatures'],
    queryFn: getSystemFeatures,
  })
  const { setSystemFeatures } = useGlobalPublicStore()
  useEffect(() => {
    if (data)
      setSystemFeatures({ ...defaultSystemFeatures, ...data })
  }, [data, setSystemFeatures])
  return <>{children}</>
}
export default GlobalPublicStoreProvider
