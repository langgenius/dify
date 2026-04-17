'use client'
import type { FC, PropsWithChildren } from 'react'
import * as React from 'react'
import { useUserProfile } from '@/service/use-common'
import Loading from './base/loading'

const Splash: FC<PropsWithChildren> = () => {
  const { isPending } = useUserProfile()

  if (isPending) {
    return (
      <div className="fixed inset-0 z-9999999 flex h-full items-center justify-center bg-background-body">
        <Loading />
      </div>
    )
  }

  return null
}
export default React.memo(Splash)
