'use client'
import { toast } from '@langgenius/dify-ui/toast'
import { useSuspenseQuery } from '@tanstack/react-query'
import * as React from 'react'
import { useCallback, useEffect } from 'react'
import { resolveWebAppLoginRedirect } from '@/app/(shareLayout)/webapp-signin/login-redirect'
import AppUnavailable from '@/app/components/base/app-unavailable'
import Loading from '@/app/components/base/loading'
import { IS_CLOUD_EDITION } from '@/config'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { SSOProtocol } from '@/features/system-features/constants'
import { useRouter, useSearchParams } from '@/next/navigation'
import { fetchWebOAuth2SSOUrl, fetchWebOIDCSSOUrl, fetchWebSAMLSSOUrl } from '@/service/share'
import { getClientLoginFallback } from '@/utils/login-redirect'
import { replaceLoginRedirect } from '@/utils/login-redirect.client'
import { basePath } from '@/utils/var'

const ExternalMemberSSOAuth = () => {
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const searchParams = useSearchParams()
  const router = useRouter()

  const redirectUrl = searchParams.get('redirect_url')

  const showErrorToast = (message: string) => {
    toast.error(message)
  }

  const handleSSOLogin = useCallback(async () => {
    const loginRedirect = resolveWebAppLoginRedirect(redirectUrl, window.location.origin)
    if (!loginRedirect) {
      replaceLoginRedirect(getClientLoginFallback(IS_CLOUD_EDITION), router.replace, basePath)
      return
    }

    switch (systemFeatures.webapp_auth.sso_config.protocol) {
      case SSOProtocol.SAML: {
        const samlRes = await fetchWebSAMLSSOUrl(loginRedirect.appCode, loginRedirect.target.href)
        router.push(samlRes.url)
        break
      }
      case SSOProtocol.OIDC: {
        const oidcRes = await fetchWebOIDCSSOUrl(loginRedirect.appCode, loginRedirect.target.href)
        router.push(oidcRes.url)
        break
      }
      case SSOProtocol.OAuth2: {
        const oauth2Res = await fetchWebOAuth2SSOUrl(
          loginRedirect.appCode,
          loginRedirect.target.href,
        )
        router.push(oauth2Res.url)
        break
      }
      case '':
        break
      default:
        showErrorToast('SSO protocol is not supported.')
    }
  }, [redirectUrl, router, systemFeatures.webapp_auth.sso_config.protocol])

  useEffect(() => {
    handleSSOLogin()
  }, [handleSSOLogin])

  if (!systemFeatures.webapp_auth.sso_config.protocol) {
    return (
      <div className="flex h-full items-center justify-center">
        <AppUnavailable code={403} unknownReason="sso protocol is invalid." />
      </div>
    )
  }

  return (
    <div className="flex h-full items-center justify-center">
      <Loading />
    </div>
  )
}

export default React.memo(ExternalMemberSSOAuth)
