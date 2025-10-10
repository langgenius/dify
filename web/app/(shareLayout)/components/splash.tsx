'use client'
import type { FC, PropsWithChildren } from 'react'
import { useEffect, useState } from 'react'
import { useCallback } from 'react'
import { useWebAppStore } from '@/context/web-app-context'
import { useRouter, useSearchParams } from 'next/navigation'
import AppUnavailable from '@/app/components/base/app-unavailable'
import { useTranslation } from 'react-i18next'
import { AccessMode } from '@/models/access-control'
import { useIsWebAppLogin, useWebAppLogout } from '@/service/use-common'
import { fetchAccessToken } from '@/service/share'
import Loading from '@/app/components/base/loading'

const Splash: FC<PropsWithChildren> = ({ children }) => {
  const { t } = useTranslation()
  const shareCode = useWebAppStore(s => s.shareCode)
  const webAppAccessMode = useWebAppStore(s => s.webAppAccessMode)
  const searchParams = useSearchParams()
  const router = useRouter()
  const redirectUrl = searchParams.get('redirect_url')
  const message = searchParams.get('message')
  const code = searchParams.get('code')
  const getSigninUrl = useCallback(() => {
    const params = new URLSearchParams(searchParams)
    params.delete('message')
    params.delete('code')
    return `/webapp-signin?${params.toString()}`
  }, [searchParams])

  const { mutateAsync: webAppLogout } = useWebAppLogout(shareCode!)
  const backToHome = useCallback(async () => {
    await webAppLogout()
    const url = getSigninUrl()
    router.replace(url)
  }, [getSigninUrl, router, webAppLogout])

  const needCheckIsLogin = webAppAccessMode !== AccessMode.PUBLIC
  const { data: isWebAppLoginData, isLoading: isWebAppLoginLoading } = useIsWebAppLogin(needCheckIsLogin, shareCode!)
  // call login api only to login the user, call fetchAccessToken to login the app
  const isUserLoggedIn = isWebAppLoginData?.logged_in
  const isAppLoggedIn = isWebAppLoginData?.app_logged_in
  const [isLoading, setIsLoading] = useState(true)
  useEffect(() => {
    if(needCheckIsLogin && isWebAppLoginLoading)
      return

    (async () => {
      if (message) {
        setIsLoading(false)
        return
      }
      if(isUserLoggedIn && !isAppLoggedIn) {
        try {
          await fetchAccessToken({ appCode: shareCode! })
          if (redirectUrl)
            router.replace(decodeURIComponent(redirectUrl))
          else
            setIsLoading(false)
        }
        finally {
          setIsLoading(false)
        }
        // passport exchange finished, return here to avoid extra checks
        return
      }

      // app is logged in from the beginning
      if ((isAppLoggedIn || webAppAccessMode === AccessMode.PUBLIC)) {
        if (redirectUrl)
          router.replace(decodeURIComponent(redirectUrl))
        else
          setIsLoading(false)
      }
    })()
  }, [shareCode, redirectUrl, router, message, webAppAccessMode, needCheckIsLogin, isWebAppLoginLoading, isAppLoggedIn])

  if (message) {
    return <div className='flex h-full flex-col items-center justify-center gap-y-4'>
      <AppUnavailable className='h-auto w-auto' code={code || t('share.common.appUnavailable')} unknownReason={message} />
      <span className='system-sm-regular cursor-pointer text-text-tertiary' onClick={backToHome}>{code === '403' ? t('common.userProfile.logout') : t('share.login.backToHome')}</span>
    </div>
  }

  if (isLoading) {
    return <div className='flex h-full items-center justify-center'>
      <Loading />
    </div>
  }
  return <>{children}</>
}

export default Splash
