'use client'
import type { FC, PropsWithChildren } from 'react'
import { useEffect } from 'react'
import { useCallback } from 'react'
import { useWebAppStore } from '@/context/web-app-context'
import { useRouter, useSearchParams } from 'next/navigation'
import AppUnavailable from '@/app/components/base/app-unavailable'
import { useTranslation } from 'react-i18next'
import { AccessMode } from '@/models/access-control'
import { useIsWebAppLogin, useWebAppLogout } from '@/service/use-common'
import { fetchAccessToken } from '@/service/share'

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

  const { mutateAsync: webAppLogout } = useWebAppLogout()
  const backToHome = useCallback(async () => {
    await webAppLogout()
    const url = getSigninUrl()
    router.replace(url)
  }, [getSigninUrl, router, webAppLogout])

  const needCheckIsLogin = webAppAccessMode !== AccessMode.PUBLIC
  const { data: isWebAppLoginData, isLoading: isWebAppLoginLoading } = useIsWebAppLogin(needCheckIsLogin)
  const isLoggedIn = isWebAppLoginData?.logged_in
  useEffect(() => {
    if(needCheckIsLogin && isWebAppLoginLoading)
      return

    (async () => {
      if (message)
        return
      if (needCheckIsLogin && isLoggedIn && shareCode && redirectUrl) {
        await fetchAccessToken({ appCode: shareCode })
        router.replace(decodeURIComponent(redirectUrl))
        return
      }
      if (webAppAccessMode === AccessMode.PUBLIC && redirectUrl)
        router.replace(decodeURIComponent(redirectUrl))
    })()
  }, [shareCode, redirectUrl, router, message, webAppAccessMode, needCheckIsLogin, isWebAppLoginLoading, isLoggedIn])

  if (message) {
    return <div className='flex h-full flex-col items-center justify-center gap-y-4'>
      <AppUnavailable className='h-auto w-auto' code={code || t('share.common.appUnavailable')} unknownReason={message} />
      <span className='system-sm-regular cursor-pointer text-text-tertiary' onClick={backToHome}>{code === '403' ? t('common.userProfile.logout') : t('share.login.backToHome')}</span>
    </div>
  }
  return <>{children}</>
}

export default Splash
