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
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const redirectUrl = searchParams.get('redirect_url')
  const [isLoading, setIsLoading] = useState(true)
  useEffect(() => {
    (async () => {
      let appCode: string | null = null
      if (redirectUrl)
        appCode = redirectUrl?.split('/').pop() || null
      else
        appCode = pathname.split('/').pop() || null

      if (!appCode)
        return
      setIsLoading(true)
      const ret = await getAppAccessModeByAppCode(appCode)
      setWebAppAccessMode(ret?.accessMode || AccessMode.PUBLIC)
      setIsLoading(false)
    })()
  }, [pathname, redirectUrl, setWebAppAccessMode])
  if (isLoading || isGlobalPending) {
    return <div className='flex h-full w-full items-center justify-center'>
      <Loading />
    </div>
  }
  return (
    <div className="min-w-[300px] h-full pb-[env(safe-area-inset-bottom)]">
      {children}
    </div>
  )
}

export default Layout
