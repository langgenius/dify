'use client'
import { useRouter, useSearchParams } from 'next/navigation'
import React, { useCallback, useEffect } from 'react'
import Toast from '@/app/components/base/toast'
import { fetchWebOAuth2SSOUrl, fetchWebOIDCSSOUrl, fetchWebSAMLSSOUrl } from '@/service/share'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { SSOProtocol } from '@/types/feature'
import Loading from '@/app/components/base/loading'
import AppUnavailable from '@/app/components/base/app-unavailable'

const ExternalMemberSSOAuth = () => {
  const systemFeatures = useGlobalPublicStore(s => s.systemFeatures)
  const searchParams = useSearchParams()
  const router = useRouter()

  const redirectUrl = searchParams.get('redirect_url')

  const showErrorToast = (message: string) => {
    Toast.notify({
      type: 'error',
      message,
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

  const handleSSOLogin = useCallback(async () => {
    const appCode = getAppCodeFromRedirectUrl()
    if (!appCode || !redirectUrl) {
      showErrorToast('redirect url or app code is invalid.')
      return
    }

    switch (systemFeatures.webapp_auth.sso_config.protocol) {
      case SSOProtocol.SAML: {
        const samlRes = await fetchWebSAMLSSOUrl(appCode, redirectUrl)
        router.push(samlRes.url)
        break
      }
      case SSOProtocol.OIDC: {
        const oidcRes = await fetchWebOIDCSSOUrl(appCode, redirectUrl)
        router.push(oidcRes.url)
        break
      }
      case SSOProtocol.OAuth2: {
        const oauth2Res = await fetchWebOAuth2SSOUrl(appCode, redirectUrl)
        router.push(oauth2Res.url)
        break
      }
      case '':
        break
      default:
        showErrorToast('SSO protocol is not supported.')
    }
  }, [getAppCodeFromRedirectUrl, redirectUrl, router, systemFeatures.webapp_auth.sso_config.protocol])

  useEffect(() => {
    handleSSOLogin()
  }, [handleSSOLogin])

  if (!systemFeatures.webapp_auth.sso_config.protocol) {
    return <div className="flex h-full items-center justify-center">
      <AppUnavailable code={403} unknownReason='sso protocol is invalid.' />
    </div>
  }

  return (
    <div className="flex h-full items-center justify-center">
      <Loading />
    </div>
  )
}

export default React.memo(ExternalMemberSSOAuth)
