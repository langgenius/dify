'use client'
import type { FC, PropsWithChildren } from 'react'
import { useEffect } from 'react'
import { useCallback } from 'react'
import { useWebAppStore } from '@/context/web-app-context'
import { useRouter, useSearchParams } from 'next/navigation'
import AppUnavailable from '@/app/components/base/app-unavailable'
import { checkOrSetAccessToken, removeAccessToken, setAccessToken } from '@/app/components/share/utils'
import { useTranslation } from 'react-i18next'
import { fetchAccessToken } from '@/service/share'
import Loading from '@/app/components/base/loading'
import { AccessMode } from '@/models/access-control'

const Splash: FC<PropsWithChildren> = ({ children }) => {
  const { t } = useTranslation()
  const shareCode = useWebAppStore(s => s.shareCode)
  const webAppAccessMode = useWebAppStore(s => s.webAppAccessMode)
  const searchParams = useSearchParams()
  const router = useRouter()
  const redirectUrl = searchParams.get('redirect_url')
  const tokenFromUrl = searchParams.get('web_sso_token')
  const message = searchParams.get('message')
  const code = searchParams.get('code')
  const getSigninUrl = useCallback(() => {
    const params = new URLSearchParams(searchParams)
    params.delete('message')
    params.delete('code')
    return `/webapp-signin?${params.toString()}`
  }, [searchParams])

  const backToHome = useCallback(() => {
    removeAccessToken()
    const url = getSigninUrl()
    router.replace(url)
  }, [getSigninUrl, router])

  useEffect(() => {
    (async () => {
      if (message)
        return
      if (shareCode && tokenFromUrl && redirectUrl) {
        localStorage.setItem('webapp_access_token', tokenFromUrl)
        const tokenResp = await fetchAccessToken({ appCode: shareCode, webAppAccessToken: tokenFromUrl })
        await setAccessToken(shareCode, tokenResp.access_token)
        router.replace(decodeURIComponent(redirectUrl))
        return
      }
      if (shareCode && redirectUrl && localStorage.getItem('webapp_access_token')) {
        const tokenResp = await fetchAccessToken({ appCode: shareCode, webAppAccessToken: localStorage.getItem('webapp_access_token') })
        await setAccessToken(shareCode, tokenResp.access_token)
        router.replace(decodeURIComponent(redirectUrl))
        return
      }
      if (webAppAccessMode === AccessMode.PUBLIC && redirectUrl) {
        await checkOrSetAccessToken(shareCode)
        router.replace(decodeURIComponent(redirectUrl))
      }
    })()
  }, [shareCode, redirectUrl, router, tokenFromUrl, message, webAppAccessMode])

  if (message) {
    return <div className='flex h-full flex-col items-center justify-center gap-y-4'>
      <AppUnavailable className='h-auto w-auto' code={code || t('share.common.appUnavailable')} unknownReason={message} />
      <span className='system-sm-regular cursor-pointer text-text-tertiary' onClick={backToHome}>{code === '403' ? t('common.userProfile.logout') : t('share.login.backToHome')}</span>
    </div>
  }
  if (tokenFromUrl) {
    return <div className='flex h-full items-center justify-center'>
      <Loading />
    </div>
  }
  if (webAppAccessMode === AccessMode.PUBLIC && redirectUrl) {
    return <div className='flex h-full items-center justify-center'>
      <Loading />
    </div>
  }
  return <>{children}</>
}

export default Splash
