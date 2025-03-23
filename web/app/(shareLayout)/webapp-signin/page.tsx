'use client'
import { useRouter, useSearchParams } from 'next/navigation'
import type { FC } from 'react'
import React, { useEffect } from 'react'
import cn from '@/utils/classnames'
import Toast from '@/app/components/base/toast'
import { fetchSystemFeatures, fetchWebOAuth2SSOUrl, fetchWebOIDCSSOUrl, fetchWebSAMLSSOUrl } from '@/service/share'
import { setAccessToken } from '@/app/components/share/utils'
import Loading from '@/app/components/base/loading'

const WebSSOForm: FC = () => {
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

  const getAppCodeFromRedirectUrl = () => {
    const appCode = redirectUrl?.split('/').pop()
    if (!appCode)
      return null

    return appCode
  }

  const processTokenAndRedirect = async () => {
    const appCode = getAppCodeFromRedirectUrl()
    if (!appCode || !tokenFromUrl || !redirectUrl) {
      showErrorToast('redirect url or app code or token is invalid.')
      return
    }

    await setAccessToken(appCode, tokenFromUrl)
    router.push(redirectUrl)
  }

  const handleSSOLogin = async (protocol: string) => {
    const appCode = getAppCodeFromRedirectUrl()
    if (!appCode || !redirectUrl) {
      showErrorToast('redirect url or app code is invalid.')
      return
    }

    switch (protocol) {
      case 'saml': {
        const samlRes = await fetchWebSAMLSSOUrl(appCode, redirectUrl)
        router.push(samlRes.url)
        break
      }
      case 'oidc': {
        const oidcRes = await fetchWebOIDCSSOUrl(appCode, redirectUrl)
        router.push(oidcRes.url)
        break
      }
      case 'oauth2': {
        const oauth2Res = await fetchWebOAuth2SSOUrl(appCode, redirectUrl)
        router.push(oauth2Res.url)
        break
      }
      default:
        showErrorToast('SSO protocol is not supported.')
    }
  }

  useEffect(() => {
    const init = async () => {
      const res = await fetchSystemFeatures()
      const protocol = res.sso_enforced_for_web_protocol

      if (message) {
        showErrorToast(message)
        return
      }

      if (!tokenFromUrl) {
        await handleSSOLogin(protocol)
        return
      }

      await processTokenAndRedirect()
    }

    init()
  }, [message, tokenFromUrl]) // Added dependencies to useEffect

  return (
    <div className="flex h-full items-center justify-center">
      <div className={cn('flex w-full grow flex-col items-center justify-center', 'px-6', 'md:px-[108px]')}>
        <Loading type='area' />
      </div>
    </div>
  )
}

export default React.memo(WebSSOForm)
