'use client'
import type { FC } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import AppUnavailable from '@/app/components/base/app-unavailable'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { useWebAppStore } from '@/context/web-app-context'
import { AccessMode } from '@/models/access-control'
import { webAppLogout } from '@/service/webapp-auth'
import ExternalMemberSsoAuth from './components/external-member-sso-auth'
import NormalForm from './normalForm'

const WebSSOForm: FC = () => {
  const { t } = useTranslation()
  const systemFeatures = useGlobalPublicStore(s => s.systemFeatures)
  const webAppAccessMode = useWebAppStore(s => s.webAppAccessMode)
  const searchParams = useSearchParams()
  const router = useRouter()

  const redirectUrl = searchParams.get('redirect_url')

  const getSigninUrl = useCallback(() => {
    const params = new URLSearchParams()
    params.append('redirect_url', redirectUrl || '')
    return `/webapp-signin?${params.toString()}`
  }, [redirectUrl])

  const shareCode = useWebAppStore(s => s.shareCode)
  const backToHome = useCallback(async () => {
    await webAppLogout(shareCode!)
    const url = getSigninUrl()
    router.replace(url)
  }, [getSigninUrl, router, webAppLogout, shareCode])

  if (!redirectUrl) {
    return (
      <div className="flex h-full items-center justify-center">
        <AppUnavailable code={t('common.appUnavailable', { ns: 'share' })} unknownReason="redirect url is invalid." />
      </div>
    )
  }

  if (!systemFeatures.webapp_auth.enabled) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="system-xs-regular text-text-tertiary">{t('webapp.disabled', { ns: 'login' })}</p>
      </div>
    )
  }
  if (webAppAccessMode && (webAppAccessMode === AccessMode.ORGANIZATION || webAppAccessMode === AccessMode.SPECIFIC_GROUPS_MEMBERS)) {
    return (
      <div className="w-full max-w-[400px]">
        <NormalForm />
      </div>
    )
  }

  if (webAppAccessMode && webAppAccessMode === AccessMode.EXTERNAL_MEMBERS)
    return <ExternalMemberSsoAuth />

  return (
    <div className="flex h-full flex-col items-center justify-center gap-y-4">
      <AppUnavailable className="h-auto w-auto" isUnknownReason={true} />
      <span className="system-sm-regular cursor-pointer text-text-tertiary" onClick={backToHome}>{t('login.backToHome', { ns: 'share' })}</span>
    </div>
  )
}

export default React.memo(WebSSOForm)
