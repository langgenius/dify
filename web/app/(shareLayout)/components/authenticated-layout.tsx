'use client'

import * as React from 'react'
import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import AppUnavailable from '@/app/components/base/app-unavailable'
import Loading from '@/app/components/base/loading'
import { useWebAppStore } from '@/context/web-app-context'
import { usePathname, useRouter, useSearchParams } from '@/next/navigation'
import { useGetUserCanAccessApp } from '@/service/access-control/use-app-access-control'
import { useGetWebAppInfo, useGetWebAppMeta, useGetWebAppParams } from '@/service/use-share'
import { resolveWebAppAddress } from '@/service/webapp-address'
import { webAppLogout } from '@/service/webapp-auth'

const AuthenticatedLayout = ({ children }: { children: React.ReactNode }) => {
  const { t } = useTranslation()
  const updateAppInfo = useWebAppStore((s) => s.updateAppInfo)
  const updateAppParams = useWebAppStore((s) => s.updateAppParams)
  const updateWebAppMeta = useWebAppStore((s) => s.updateWebAppMeta)
  const updateUserCanAccessApp = useWebAppStore((s) => s.updateUserCanAccessApp)
  const {
    isLoading: isLoadingAppParams,
    data: appParams,
    error: appParamsError,
  } = useGetWebAppParams()
  const { isLoading: isLoadingAppInfo, data: appInfo, error: appInfoError } = useGetWebAppInfo()
  const { isLoading: isLoadingAppMeta, data: appMeta, error: appMetaError } = useGetWebAppMeta()
  const { data: userCanAccessApp, error: useCanAccessAppError } = useGetUserCanAccessApp({
    appId: appInfo?.app_id,
    isInstalledApp: false,
  })

  useEffect(() => {
    if (appInfo) updateAppInfo(appInfo)
    if (appParams) updateAppParams(appParams)
    if (appMeta) updateWebAppMeta(appMeta)
    updateUserCanAccessApp(Boolean(userCanAccessApp && userCanAccessApp?.result))
  }, [
    appInfo,
    appMeta,
    appParams,
    updateAppInfo,
    updateAppParams,
    updateUserCanAccessApp,
    updateWebAppMeta,
    userCanAccessApp,
  ])

  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const getSigninUrl = useCallback(() => {
    const params = new URLSearchParams(searchParams)
    params.delete('message')
    const query = params.toString()
    const fullPath = query ? `${pathname}?${query}` : pathname
    params.set('redirect_url', fullPath)
    return `/webapp-signin?${params.toString()}`
  }, [searchParams, pathname])

  const backToHome = useCallback(async () => {
    await webAppLogout(resolveWebAppAddress())
    const url = getSigninUrl()
    router.replace(url)
  }, [getSigninUrl, router])

  if (appInfoError) {
    return (
      <div className="flex h-full items-center justify-center">
        <AppUnavailable unknownReason={appInfoError.message} />
      </div>
    )
  }
  if (appParamsError) {
    return (
      <div className="flex h-full items-center justify-center">
        <AppUnavailable unknownReason={appParamsError.message} />
      </div>
    )
  }
  if (appMetaError) {
    return (
      <div className="flex h-full items-center justify-center">
        <AppUnavailable unknownReason={appMetaError.message} />
      </div>
    )
  }
  if (useCanAccessAppError) {
    return (
      <div className="flex h-full items-center justify-center">
        <AppUnavailable unknownReason={useCanAccessAppError.message} />
      </div>
    )
  }
  if (userCanAccessApp && !userCanAccessApp.result) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-y-2">
        <AppUnavailable className="size-auto" code={403} unknownReason="no permission." />
        <button
          type="button"
          className="cursor-pointer appearance-none system-sm-regular text-text-tertiary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
          onClick={backToHome}
        >
          {t(($) => $['userProfile.logout'], { ns: 'common' })}
        </button>
      </div>
    )
  }
  if (
    isLoadingAppInfo ||
    isLoadingAppParams ||
    isLoadingAppMeta ||
    !appInfo ||
    !appParams ||
    !appMeta
  ) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loading />
      </div>
    )
  }
  return <>{children}</>
}

export default React.memo(AuthenticatedLayout)
