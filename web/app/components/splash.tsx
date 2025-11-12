'use client'
import type { FC, PropsWithChildren } from 'react'
import React from 'react'
import { useIsLogin } from '@/service/use-common'
import Loading from './base/loading'

const Splash: FC<PropsWithChildren> = ({
  children,
}) => {
  // would auto redirect to signin page if not logged in
  const { isLoading, data: loginData } = useIsLogin()
  const isLoggedIn = loginData?.logged_in

  if (isLoading || !isLoggedIn) {
    return (
      <div className='flex h-full items-center justify-center'>
        <Loading />
      </div>
    )
  }
  return (
    <>
      {children}
    </>
  )
}
export default React.memo(Splash)
