'use client'
import { useRouter, useSearchParams } from 'next/navigation'
import type { FC } from 'react'
import React, { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import Toast from '@/app/components/base/toast'
import { removeAccessToken, setAccessToken } from '@/app/components/share/utils'
import { useGlobalPublicStore } from '@/context/global-public-context'
import Loading from '@/app/components/base/loading'
import AppUnavailable from '@/app/components/base/app-unavailable'
import NormalForm from './normalForm'
import { AccessMode } from '@/models/access-control'
import ExternalMemberSsoAuth from './components/external-member-sso-auth'
import { fetchAccessToken } from '@/service/share'

const WebSSOForm: FC = () => {
  const { t } = useTranslation()
  const systemFeatures = useGlobalPublicStore(s => s.systemFeatures)
  const webAppAccessMode = useGlobalPublicStore(s => s.webAppAccessMode)
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

  const showErrorToast = (msg: string) => {
    Toast.notify({
      type: 'error',
      message: msg,
    })
  }

  const getAppCodeFromRedirectUrl = useCallback(() => {
    if (!redirectUrl)
      return null
    const url = new URL(`${window.location.origin}${decodeURIComponent(redirectUrl)}`)
    const appCode = url.pathname.split('/').pop()
    if (!appCode)
      return null

    return appCode
  }, [redirectUrl])

  useEffect(() => {
    (async () => {
      if (message)
        return

      const appCode = getAppCodeFromRedirectUrl()
      if (appCode && tokenFromUrl && redirectUrl) {
        localStorage.setItem('webapp_access_token', tokenFromUrl)
        const tokenResp = await fetchAccessToken({ appCode, webAppAccessToken: tokenFromUrl })
        await setAccessToken(appCode, tokenResp.access_token)
        router.replace(decodeURIComponent(redirectUrl))
        return
      }
      if (appCode && redirectUrl && localStorage.getItem('webapp_access_token')) {
        const tokenResp = await fetchAccessToken({ appCode, webAppAccessToken: localStorage.getItem('webapp_access_token') })
        await setAccessToken(appCode, tokenResp.access_token)
        router.replace(decodeURIComponent(redirectUrl))
      }
    })()
  }, [getAppCodeFromRedirectUrl, redirectUrl, router, tokenFromUrl, message])

  useEffect(() => {
    if (webAppAccessMode && webAppAccessMode === AccessMode.PUBLIC && redirectUrl)
      router.replace(decodeURIComponent(redirectUrl))
  }, [webAppAccessMode, router, redirectUrl])

  if (tokenFromUrl) {
    return <div className='flex h-full items-center justify-center'>
      <Loading />
    </div>
  }

  if (message) {
    return <div className='flex h-full flex-col items-center justify-center gap-y-4'>
      <AppUnavailable className='h-auto w-auto' code={code || t('share.common.appUnavailable')} unknownReason={message} />
      <span className='system-sm-regular cursor-pointer text-text-tertiary' onClick={backToHome}>{code === '403' ? t('common.userProfile.logout') : t('share.login.backToHome')}</span>
    </div>
  }
  if (!redirectUrl) {
    showErrorToast('redirect url is invalid.')
    return <div className='flex h-full items-center justify-center'>
      <AppUnavailable code={t('share.common.appUnavailable')} unknownReason='redirect url is invalid.' />
    </div>
  }
  if (webAppAccessMode && webAppAccessMode === AccessMode.PUBLIC) {
    return <div className='flex h-full items-center justify-center'>
      <Loading />
    </div>
  }
  if (!systemFeatures.webapp_auth.enabled) {
    return <div className="flex h-full items-center justify-center">
      <p className='system-xs-regular text-text-tertiary'>{t('login.webapp.disabled')}</p>
    </div>
  }
  if (webAppAccessMode && (webAppAccessMode === AccessMode.ORGANIZATION || webAppAccessMode === AccessMode.SPECIFIC_GROUPS_MEMBERS)) {
    return <div className='w-full max-w-[400px]'>
      <NormalForm />
    </div>
  }

  if (webAppAccessMode && webAppAccessMode === AccessMode.EXTERNAL_MEMBERS)
    return <ExternalMemberSsoAuth />

  return <div className='flex h-full flex-col items-center justify-center gap-y-4'>
    <AppUnavailable className='h-auto w-auto' isUnknownReason={true} />
    <span className='system-sm-regular cursor-pointer text-text-tertiary' onClick={backToHome}>{t('share.login.backToHome')}</span>
  </div>
}

export default React.memo(WebSSOForm)
