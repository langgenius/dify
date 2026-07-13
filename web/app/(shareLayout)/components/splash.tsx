'use client'
import type { PropsWithChildren } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  isWebAppSigninPath,
  resolveWebAppLoginRedirect,
} from '@/app/(shareLayout)/webapp-signin/login-redirect'
import AppUnavailable from '@/app/components/base/app-unavailable'
import Loading from '@/app/components/base/loading'
import { IS_CLOUD_EDITION } from '@/config'
import { useWebAppStore } from '@/context/web-app-context'
import { usePathname, useRouter, useSearchParams } from '@/next/navigation'
import { fetchAccessToken } from '@/service/share'
import {
  setWebAppAccessToken,
  setWebAppPassport,
  webAppLoginStatus,
  webAppLogout,
} from '@/service/webapp-auth'
import { getClientLoginFallback } from '@/utils/login-redirect'
import { replaceLoginRedirect } from '@/utils/login-redirect.client'
import { basePath } from '@/utils/var'

function Splash({ children }: PropsWithChildren) {
  const { t } = useTranslation()
  const shareCode = useWebAppStore(s => s.shareCode)
  const webAppAccessMode = useWebAppStore(s => s.webAppAccessMode)
  const embeddedUserId = useWebAppStore(s => s.embeddedUserId)
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  const redirectUrl = searchParams.get('redirect_url')
  const message = searchParams.get('message')
  const code = searchParams.get('code')
  const tokenFromUrl = searchParams.get('web_sso_token')
  const getSigninUrl = useCallback(() => {
    const params = new URLSearchParams(searchParams)
    params.delete('message')
    params.delete('code')
    const loginRedirect = resolveWebAppLoginRedirect(redirectUrl, window.location.origin)
    if (loginRedirect) params.set('redirect_url', loginRedirect.target.href)
    else params.delete('redirect_url')
    return `/webapp-signin?${params.toString()}`
  }, [redirectUrl, searchParams])

  const backToHome = useCallback(async () => {
    const loginRedirect = resolveWebAppLoginRedirect(redirectUrl, window.location.origin)
    const effectiveShareCode = loginRedirect?.appCode || shareCode
    if (!effectiveShareCode || (isWebAppSigninPath(pathname) && !loginRedirect)) {
      replaceLoginRedirect(getClientLoginFallback(IS_CLOUD_EDITION), router.replace, basePath)
      return
    }

    await webAppLogout(effectiveShareCode)
    const url = getSigninUrl()
    router.replace(url)
  }, [getSigninUrl, pathname, redirectUrl, router, shareCode])

  const [isLoading, setIsLoading] = useState(true)
  useEffect(() => {
    const loginRedirect = resolveWebAppLoginRedirect(redirectUrl, window.location.origin)
    const isSigninRoute = isWebAppSigninPath(pathname)
    if ((redirectUrl !== null && !loginRedirect) || (isSigninRoute && !loginRedirect)) {
      replaceLoginRedirect(getClientLoginFallback(IS_CLOUD_EDITION), router.replace, basePath)
      return
    }

    const effectiveShareCode = loginRedirect?.appCode || shareCode
    if (!effectiveShareCode) return

    if (message) return

    if (tokenFromUrl) setWebAppAccessToken(tokenFromUrl)

    const redirectOrFinish = () => {
      if (loginRedirect) replaceLoginRedirect(loginRedirect.target, router.replace, basePath)
      else setIsLoading(false)
    }

    const proceedToAuth = () => {
      setIsLoading(false)
    }

    (async () => {
      // if access mode is public, user login is always true, but the app login(passport) may be expired
      const { userLoggedIn, appLoggedIn } = await webAppLoginStatus(
        effectiveShareCode,
        embeddedUserId || undefined,
      )
      if (userLoggedIn && appLoggedIn) {
        redirectOrFinish()
      }
      else if (!userLoggedIn && !appLoggedIn) {
        proceedToAuth()
      }
      else if (!userLoggedIn && appLoggedIn) {
        redirectOrFinish()
      }
      else if (userLoggedIn && !appLoggedIn) {
        try {
          const { access_token } = await fetchAccessToken({
            appCode: effectiveShareCode,
            userId: embeddedUserId || undefined,
          })
          setWebAppPassport(effectiveShareCode, access_token)
          redirectOrFinish()
        } catch {
          await webAppLogout(effectiveShareCode)
          proceedToAuth()
        }
      }
    })()
  }, [
    shareCode,
    redirectUrl,
    pathname,
    router,
    message,
    webAppAccessMode,
    tokenFromUrl,
    embeddedUserId,
  ])

  if (message) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-y-4">
        <AppUnavailable className="size-auto" code={code || t('common.appUnavailable', { ns: 'share' })} unknownReason={message} />
        <span className="cursor-pointer system-sm-regular text-text-tertiary" onClick={backToHome}>{code === '403' ? t('userProfile.logout', { ns: 'common' }) : t('login.backToHome', { ns: 'share' })}</span>
      </div>
    )
  }

  if (!shareCode && redirectUrl === null && !isWebAppSigninPath(pathname)) return <>{children}</>

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loading />
      </div>
    )
  }
  return <>{children}</>
}

export default Splash
