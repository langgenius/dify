'use client'
import { Button } from '@langgenius/dify-ui/button'
import { toast } from '@langgenius/dify-ui/toast'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { resolveWebAppLoginRedirect } from '@/app/(shareLayout)/webapp-signin/login-redirect'
import { Lock01 } from '@/app/components/base/icons/src/vender/solid/security'
import { IS_CLOUD_EDITION } from '@/config'
import { SSOProtocol } from '@/features/system-features/constants'
import { useRouter, useSearchParams } from '@/next/navigation'
import {
  fetchMembersOAuth2SSOUrl,
  fetchMembersOIDCSSOUrl,
  fetchMembersSAMLSSOUrl,
} from '@/service/share'
import { getClientLoginFallback } from '@/utils/login-redirect'
import { replaceLoginRedirect } from '@/utils/login-redirect.client'
import { basePath } from '@/utils/var'

type SSOAuthProps = {
  protocol: string
}

function SSOAuth({ protocol }: SSOAuthProps) {
  const router = useRouter()
  const { t } = useTranslation()
  const searchParams = useSearchParams()

  const redirectUrl = searchParams.get('redirect_url')

  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!resolveWebAppLoginRedirect(redirectUrl, window.location.origin))
      replaceLoginRedirect(getClientLoginFallback(IS_CLOUD_EDITION), router.replace, basePath)
  }, [redirectUrl, router])

  const handleSSOLogin = () => {
    const loginRedirect = resolveWebAppLoginRedirect(redirectUrl, window.location.origin)
    if (!loginRedirect) {
      replaceLoginRedirect(getClientLoginFallback(IS_CLOUD_EDITION), router.replace, basePath)
      return
    }
    setIsLoading(true)
    if (protocol === SSOProtocol.SAML) {
      fetchMembersSAMLSSOUrl(loginRedirect.appCode, loginRedirect.target.href)
        .then((res) => {
          router.push(res.url)
        })
        .finally(() => {
          setIsLoading(false)
        })
    } else if (protocol === SSOProtocol.OIDC) {
      fetchMembersOIDCSSOUrl(loginRedirect.appCode, loginRedirect.target.href)
        .then((res) => {
          router.push(res.url)
        })
        .finally(() => {
          setIsLoading(false)
        })
    } else if (protocol === SSOProtocol.OAuth2) {
      fetchMembersOAuth2SSOUrl(loginRedirect.appCode, loginRedirect.target.href)
        .then((res) => {
          router.push(res.url)
        })
        .finally(() => {
          setIsLoading(false)
        })
    } else {
      toast.error(t('error.invalidSSOProtocol', { ns: 'login' }))
      setIsLoading(false)
    }
  }

  return (
    <Button
      tabIndex={0}
      onClick={() => { handleSSOLogin() }}
      disabled={isLoading}
      className="w-full"
    >
      <Lock01 className="mr-2 size-5 text-text-accent-light-mode-only" />
      <span className="truncate">{t('withSSO', { ns: 'login' })}</span>
    </Button>
  )
}

export default SSOAuth
