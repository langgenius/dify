'use client'
import { useRouter, useSearchParams } from 'next/navigation'
import type { FC } from 'react'
import React, { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import Toast from '@/app/components/base/toast'
import { checkOrSetAccessToken } from '@/app/components/share/utils'
import { useGlobalPublicStore } from '@/context/global-public-context'
import Loading from '@/app/components/base/loading'
import AppUnavailable from '@/app/components/base/app-unavailable'
import NormalForm from './normalForm'
import { AccessMode } from '@/models/access-control'
import ExternalMemberSsoAuth from './components/external-member-sso-auth'

const WebSSOForm: FC = () => {
  const { t } = useTranslation()
  const systemFeatures = useGlobalPublicStore(s => s.systemFeatures)
  const webAppAccessMode = useGlobalPublicStore(s => s.webAppAccessMode)
  const searchParams = useSearchParams()
  const router = useRouter()

  const redirectUrl = searchParams.get('redirect_url')
  const tokenFromUrl = searchParams.get('web_sso_token')
  const message = searchParams.get('message')

  const showErrorToast = (message: string) => {
    Toast.notify({
      type: 'error',
      message,
    })
  }

  const getAppCodeFromRedirectUrl = useCallback(() => {
    const appCode = redirectUrl?.split('/').pop()
    if (!appCode)
      return null

    return appCode
  }, [redirectUrl])

  useEffect(() => {
    (async () => {
      const appCode = getAppCodeFromRedirectUrl()
      if (appCode && tokenFromUrl && redirectUrl) {
        localStorage.setItem('webAppAccessToken', tokenFromUrl)
        await checkOrSetAccessToken(appCode)
        router.replace(redirectUrl)
      }
    })()
  }, [getAppCodeFromRedirectUrl, redirectUrl, router, tokenFromUrl])

  useEffect(() => {
    if (webAppAccessMode && webAppAccessMode === AccessMode.PUBLIC && redirectUrl)
      router.replace(redirectUrl)
  }, [webAppAccessMode, router, redirectUrl])

  if (tokenFromUrl) {
    return <div className='flex h-full items-center justify-center'>
      <Loading />
    </div>
  }

  if (message) {
    return <div className='flex h-full items-center justify-center'>
      <AppUnavailable code={'App Unavailable'} unknownReason={message} />
    </div>
  }
  if (!redirectUrl) {
    showErrorToast('redirect url is invalid.')
    return <div className='flex h-full items-center justify-center'>
      <AppUnavailable code={'App Unavailable'} unknownReason='redirect url is invalid.' />
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
    return <div className='w-[400px]'>
      <NormalForm />
    </div>
  }

  if (webAppAccessMode && webAppAccessMode === AccessMode.EXTERNAL_MEMBERS)
    return <ExternalMemberSsoAuth />

  return <div className='flex h-full items-center justify-center'>
    <AppUnavailable code={'App Unavailable'} isUnknownReason={true} />
  </div>
}

export default React.memo(WebSSOForm)
