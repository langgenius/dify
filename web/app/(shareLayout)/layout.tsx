'use client'
import React, { useEffect, useState } from 'react'
import type { FC } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import Loading from '../components/base/loading'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { AccessMode } from '@/models/access-control'
import { getAppAccessModeByAppCode } from '@/service/share'

const Layout: FC<{
  children: React.ReactNode
}> = ({ children }) => {
  const isGlobalPending = useGlobalPublicStore(s => s.isGlobalPending)
  const setWebAppAccessMode = useGlobalPublicStore(s => s.setWebAppAccessMode)
  const systemFeatures = useGlobalPublicStore(s => s.systemFeatures)
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const redirectUrl = searchParams.get('redirect_url')
  const [isLoading, setIsLoading] = useState(true)
  useEffect(() => {
    (async () => {
      if (!isGlobalPending && !systemFeatures.webapp_auth.enabled) {
        setIsLoading(false)
        return
      }

      let appCode: string | null = null
      if (redirectUrl) {
        const url = new URL(`${window.location.origin}${decodeURIComponent(redirectUrl)}`)
        appCode = url.pathname.split('/').pop() || null
      }
      else {
        appCode = pathname.split('/').pop() || null
      }

      if (!appCode)
        return
      setIsLoading(true)
      const ret = await getAppAccessModeByAppCode(appCode)
      setWebAppAccessMode(ret?.accessMode || AccessMode.PUBLIC)
      setIsLoading(false)
    })()
  }, [pathname, redirectUrl, setWebAppAccessMode, isGlobalPending, systemFeatures.webapp_auth.enabled])
  if (isLoading || isGlobalPending) {
    return <div className='flex h-full w-full items-center justify-center'>
      <Loading />
    </div>
  }
  return (
    <div className="h-full min-w-[300px] pb-[env(safe-area-inset-bottom)]">
      {children}
    </div>
  )
}

export default Layout
