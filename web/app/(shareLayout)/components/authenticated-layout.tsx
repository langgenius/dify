'use client'
import { useQuery } from '@tanstack/react-query'
import * as React from 'react'
import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import AppUnavailable from '@/app/components/base/app-unavailable'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { reportRequestError } from '@/app/query-error-toast'
import { useWebAppStore } from '@/context/web-app-context'
import { usePathname, useRouter, useSearchParams } from '@/next/navigation'
import { useGetUserCanAccessApp } from '@/service/access-control/use-app-access-control'
import { webAppLogout } from '@/service/common'
import {
  webAppInfoQueryOptions,
  webAppMetaQueryOptions,
  webAppParamsQueryOptions,
} from '@/service/share-queries'
import { useOwnedQueryErrors } from '@/service/use-owned-query-error'
import { useRequestErrorMessage } from '@/service/use-request-error-message'
import { resolveWebAppAddress } from '@/service/webapp-address'

const AuthenticatedLayout = ({ children }: { children: React.ReactNode }) => {
  const { t } = useTranslation(['common'])
  const updateAppInfo = useWebAppStore((s) => s.updateAppInfo)
  const updateAppParams = useWebAppStore((s) => s.updateAppParams)
  const updateWebAppMeta = useWebAppStore((s) => s.updateWebAppMeta)
  const updateUserCanAccessApp = useWebAppStore((s) => s.updateUserCanAccessApp)
  const appParamsQuery = useQuery(webAppParamsQueryOptions())
  const { isLoading: isLoadingAppParams, data: appParams } = appParamsQuery
  const appInfoQuery = useQuery(webAppInfoQueryOptions())
  const { isLoading: isLoadingAppInfo, data: appInfo } = appInfoQuery
  const appMetaQuery = useQuery(webAppMetaQueryOptions())
  const { isLoading: isLoadingAppMeta, data: appMeta } = appMetaQuery
  const userCanAccessAppQuery = useGetUserCanAccessApp({
    appId: appInfo?.app_id,
    isInstalledApp: false,
  })
  const { data: userCanAccessApp } = userCanAccessAppQuery
  // The first failed read replaces the app; a failed refetch keeps it and the cache reports it.
  const appLoad = useOwnedQueryErrors([
    appInfoQuery,
    appParamsQuery,
    appMetaQuery,
    userCanAccessAppQuery,
  ])
  const appLoadErrorMessage = useRequestErrorMessage(appLoad?.error)

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
    try {
      await webAppLogout(resolveWebAppAddress())
    } catch (error) {
      reportRequestError(error)
      return
    }
    const url = getSigninUrl()
    router.replace(url)
  }, [getSigninUrl, router])

  if (appLoad) {
    return (
      <div className="flex h-full items-center justify-center">
        <AppUnavailable unknownReason={appLoadErrorMessage} />
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
        <LoadingPlaceholder />
      </div>
    )
  }
  return <>{children}</>
}

export default React.memo(AuthenticatedLayout)
