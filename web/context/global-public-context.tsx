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
  const { isPending, data } = useQuery({
    queryKey: ['systemFeatures'],
    queryFn: getSystemFeatures,
  })
  const { setSystemFeatures } = useGlobalPublicStore()
  useEffect(() => {
    if (data)
      setSystemFeatures({ ...defaultSystemFeatures, ...data })
  }, [data, setSystemFeatures])
  if (isPending)
    return <div className='w-screen h-screen flex items-center justify-center'><Loading /></div>
  return <>{children}</>
}
export default GlobalPublicStoreProvider
