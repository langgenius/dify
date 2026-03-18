'use client'
import type { FC, PropsWithChildren } from 'react'
import * as React from 'react'
import { useIsLogin } from '@/service/use-common'

const Splash: FC<PropsWithChildren> = () => {
  // would auto redirect to signin page if not logged in
  const { isLoading, data: loginData } = useIsLogin()
  const isLoggedIn = loginData?.logged_in

  if (isLoading || !isLoggedIn)
    return null

  return null
}
export default React.memo(Splash)
