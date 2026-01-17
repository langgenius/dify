'use client'
import type { FC, PropsWithChildren } from 'react'
import * as React from 'react'
import { useIsLogin } from '@/service/use-common'
import Loading from './base/loading'

const Splash: FC<PropsWithChildren> = () => {
  // would auto redirect to signin page if not logged in
  const { isLoading, data: loginData } = useIsLogin()
  const isLoggedIn = loginData?.logged_in

  if (isLoading || !isLoggedIn) {
    return (
      <div className="fixed inset-0 z-[9999999] flex h-full items-center justify-center bg-background-body">
        <Loading />
      </div>
    )
  }
  return null
}
export default React.memo(Splash)
