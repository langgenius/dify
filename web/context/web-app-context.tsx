'use client'

import Loading from '@/app/components/base/loading'
import { AccessMode } from '@/models/access-control'
import { useAppAccessModeByCode } from '@/service/use-share'
import type { App } from '@/types/app'
import { usePathname, useSearchParams } from 'next/navigation'
import type { FC, PropsWithChildren } from 'react'
import { useEffect } from 'react'
import { useState } from 'react'
import { create } from 'zustand'

type WebAppStore = {
  shareCode: string | null
  updateShareCode: (shareCode: string | null) => void
  appInfo: App | null
  updateAppInfo: (appInfo: App | null) => void
  webAppAccessMode: AccessMode
  updateWebAppAccessMode: (accessMode: AccessMode) => void
}

export const useWebAppStore = create<WebAppStore>(set => ({
  shareCode: null,
  updateShareCode: (shareCode: string | null) => set(() => ({ shareCode })),
  appInfo: null,
  updateAppInfo: (appInfo: App | null) => set(() => ({ appInfo })),
  webAppAccessMode: AccessMode.SPECIFIC_GROUPS_MEMBERS,
  updateWebAppAccessMode: (accessMode: AccessMode) => set(() => ({ webAppAccessMode: accessMode })),
}))

const getShareCodeFromRedirectUrl = (redirectUrl: string | null): string | null => {
  if (!redirectUrl || redirectUrl.length === 0)
    return null
  const url = new URL(`${window.location.origin}${decodeURIComponent(redirectUrl)}`)
  return url.pathname.split('/').pop() || null
}
const getShareCodeFromPathname = (pathname: string): string | null => {
  const code = pathname.split('/').pop() || null
  if (code === 'webapp-signin')
    return null
  return code
}

const WebAppStoreProvider: FC<PropsWithChildren> = ({ children }) => {
  const updateWebAppAccessMode = useWebAppStore(state => state.updateWebAppAccessMode)
  const updateShareCode = useWebAppStore(state => state.updateShareCode)
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const redirectUrlParam = searchParams.get('redirect_url')
  const [shareCode, setShareCode] = useState<string | null>(null)
  useEffect(() => {
    const shareCodeFromRedirect = getShareCodeFromRedirectUrl(redirectUrlParam)
    const shareCodeFromPathname = getShareCodeFromPathname(pathname)
    const newShareCode = shareCodeFromRedirect || shareCodeFromPathname
    setShareCode(newShareCode)
    updateShareCode(newShareCode)
  }, [pathname, redirectUrlParam, updateShareCode])
  const { isFetching, data: accessModeResult } = useAppAccessModeByCode(shareCode)
  useEffect(() => {
    if (accessModeResult?.accessMode)
      updateWebAppAccessMode(accessModeResult.accessMode)
  }, [accessModeResult, updateWebAppAccessMode])
  if (isFetching) {
    return <div className='flex h-full w-full items-center justify-center'>
      <Loading />
    </div>
  }
  return (
    <>
      {children}
    </>
  )
}
export default WebAppStoreProvider
