'use client'

import AppUnavailable from '@/app/components/base/app-unavailable'
import Loading from '@/app/components/base/loading'
import { useWebAppStore } from '@/context/web-app-context'
import { useGetUserCanAccessApp } from '@/service/access-control'
import { useGetWebAppInfo, useGetWebAppMeta, useGetWebAppParams } from '@/service/use-share'
import { webAppLogout } from '@/service/webapp-auth'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import React, { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

const AuthenticatedLayout = ({ children }: { children: React.ReactNode }) => {
  const { t } = useTranslation()
  const shareCode = useWebAppStore(s => s.shareCode)
  const updateAppInfo = useWebAppStore(s => s.updateAppInfo)
  const updateAppParams = useWebAppStore(s => s.updateAppParams)
  const updateWebAppMeta = useWebAppStore(s => s.updateWebAppMeta)
  const updateUserCanAccessApp = useWebAppStore(s => s.updateUserCanAccessApp)
  const { isFetching: isFetchingAppParams, data: appParams, error: appParamsError } = useGetWebAppParams()
  const { isFetching: isFetchingAppInfo, data: appInfo, error: appInfoError } = useGetWebAppInfo()
  const { isFetching: isFetchingAppMeta, data: appMeta, error: appMetaError } = useGetWebAppMeta()
  const { data: userCanAccessApp, error: useCanAccessAppError } = useGetUserCanAccessApp({ appId: appInfo?.app_id, isInstalledApp: false })

  useEffect(() => {
    if (appInfo)
      updateAppInfo(appInfo)
    if (appParams)
      updateAppParams(appParams)
    if (appMeta)
      updateWebAppMeta(appMeta)
    updateUserCanAccessApp(Boolean(userCanAccessApp && userCanAccessApp?.result))
  }, [appInfo, appMeta, appParams, updateAppInfo, updateAppParams, updateUserCanAccessApp, updateWebAppMeta, userCanAccessApp])

  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const getSigninUrl = useCallback(() => {
    const params = new URLSearchParams(searchParams)
    params.delete('message')
    params.set('redirect_url', pathname)
    return `/webapp-signin?${params.toString()}`
  }, [searchParams, pathname])

  const backToHome = useCallback(async () => {
    await webAppLogout(shareCode!)
    const url = getSigninUrl()
    router.replace(url)
  }, [getSigninUrl, router, webAppLogout, shareCode])

  if (appInfoError) {
    return <div className='flex h-full items-center justify-center'>
      <AppUnavailable unknownReason={appInfoError.message} />
    </div>
  }
  if (appParamsError) {
    return <div className='flex h-full items-center justify-center'>
      <AppUnavailable unknownReason={appParamsError.message} />
    </div>
  }
  if (appMetaError) {
    return <div className='flex h-full items-center justify-center'>
      <AppUnavailable unknownReason={appMetaError.message} />
    </div>
  }
  if (useCanAccessAppError) {
    return <div className='flex h-full items-center justify-center'>
      <AppUnavailable unknownReason={useCanAccessAppError.message} />
    </div>
  }
  if (userCanAccessApp && !userCanAccessApp.result) {
    return <div className='flex h-full flex-col items-center justify-center gap-y-2'>
      <AppUnavailable className='h-auto w-auto' code={403} unknownReason='no permission.' />
      <span className='system-sm-regular cursor-pointer text-text-tertiary' onClick={backToHome}>{t('common.userProfile.logout')}</span>
    </div>
  }
  if (isFetchingAppInfo || isFetchingAppParams || isFetchingAppMeta) {
    return <div className='flex h-full items-center justify-center'>
      <Loading />
    </div>
  }
  return <>{children}</>
}

export default React.memo(AuthenticatedLayout)
