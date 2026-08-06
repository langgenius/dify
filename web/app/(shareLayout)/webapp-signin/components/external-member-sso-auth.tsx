'use client'
import { zSsoProtocol } from '@dify/contracts/api/console/system-features/zod.gen'
import { toast } from '@langgenius/dify-ui/toast'
import { useSuspenseQuery } from '@tanstack/react-query'
import * as React from 'react'
import { useCallback, useEffect } from 'react'
import { resolveWebAppLoginRedirect } from '@/app/(shareLayout)/webapp-signin/login-redirect'
import AppUnavailable from '@/app/components/base/app-unavailable'
import Loading from '@/app/components/base/loading'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
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
  const protocol = systemFeatures.webapp_auth.sso_config.protocol

  const handleSSOLogin = useCallback(async () => {
    if (protocol === null) return

    const loginRedirect = resolveWebAppLoginRedirect(redirectUrl, window.location.origin)
    if (!loginRedirect) {
      replaceLoginRedirect(getClientLoginFallback(), router.replace, basePath)
      return
    }

    switch (protocol) {
      case zSsoProtocol.enum.saml: {
        const samlRes = await fetchWebSAMLSSOUrl(loginRedirect.appCode, loginRedirect.target.href)
        router.push(samlRes.url)
        break
      }
      case zSsoProtocol.enum.oidc: {
        const oidcRes = await fetchWebOIDCSSOUrl(loginRedirect.appCode, loginRedirect.target.href)
        router.push(oidcRes.url)
        break
      }
      case zSsoProtocol.enum.oauth2: {
        const oauth2Res = await fetchWebOAuth2SSOUrl(
          loginRedirect.appCode,
          loginRedirect.target.href,
        )
        router.push(oauth2Res.url)
        break
      }
      default:
        toast.error('SSO protocol is not supported.')
    }
  }, [protocol, redirectUrl, router])

  useEffect(() => {
    handleSSOLogin()
  }, [handleSSOLogin])

  if (protocol === null) {
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
