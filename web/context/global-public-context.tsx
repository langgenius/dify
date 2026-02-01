'use client'
import type { FC, PropsWithChildren } from 'react'
import Loading from '@/app/components/base/loading'
import { useSetupStatusQuery, useSystemFeaturesQuery } from '@/hooks/use-global-public'

const GlobalPublicStoreProvider: FC<PropsWithChildren> = ({
  children,
}) => {
  const { isPending } = useSystemFeaturesQuery()
  useSetupStatusQuery()

  if (isPending)
    return <div className="flex h-screen w-screen items-center justify-center"><Loading /></div>
  return <>{children}</>
}
export default GlobalPublicStoreProvider
