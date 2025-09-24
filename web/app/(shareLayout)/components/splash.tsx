'use client'
import type { FC, PropsWithChildren } from 'react'
import { useEffect } from 'react'
import { useCallback } from 'react'
import { useWebAppStore } from '@/context/web-app-context'
import { useRouter, useSearchParams } from 'next/navigation'
import AppUnavailable from '@/app/components/base/app-unavailable'
import { useTranslation } from 'react-i18next'
import { AccessMode } from '@/models/access-control'
import { useWebAppLogout } from '@/service/use-common'

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

  useEffect(() => {
    (async () => {
      if (message)
        return
      if (shareCode && redirectUrl) {
        router.replace(decodeURIComponent(redirectUrl))
        return
      }
      if (webAppAccessMode === AccessMode.PUBLIC && redirectUrl)
        router.replace(decodeURIComponent(redirectUrl))
    })()
  }, [shareCode, redirectUrl, router, message, webAppAccessMode])

  if (message) {
    return <div className='flex h-full flex-col items-center justify-center gap-y-4'>
      <AppUnavailable className='h-auto w-auto' code={code || t('share.common.appUnavailable')} unknownReason={message} />
      <span className='system-sm-regular cursor-pointer text-text-tertiary' onClick={backToHome}>{code === '403' ? t('common.userProfile.logout') : t('share.login.backToHome')}</span>
    </div>
  }
  return <>{children}</>
}

export default Splash
