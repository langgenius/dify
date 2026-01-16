'use client'
import type { FC } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { Lock01 } from '@/app/components/base/icons/src/vender/solid/security'
import Toast from '@/app/components/base/toast'
import { fetchMembersOAuth2SSOUrl, fetchMembersOIDCSSOUrl, fetchMembersSAMLSSOUrl } from '@/service/share'
import { SSOProtocol } from '@/types/feature'

type SSOAuthProps = {
  protocol: SSOProtocol | ''
}

const SSOAuth: FC<SSOAuthProps> = ({
  protocol,
}) => {
  const router = useRouter()
  const { t } = useTranslation()
  const searchParams = useSearchParams()

  const redirectUrl = searchParams.get('redirect_url')
  const getAppCodeFromRedirectUrl = useCallback(() => {
    if (!redirectUrl)
      return null
    const url = new URL(`${window.location.origin}${decodeURIComponent(redirectUrl)}`)
    const appCode = url.pathname.split('/').pop()
    if (!appCode)
      return null

    return appCode
  }, [redirectUrl])

  const [isLoading, setIsLoading] = useState(false)

  const handleSSOLogin = () => {
    const appCode = getAppCodeFromRedirectUrl()
    if (!redirectUrl || !appCode) {
      Toast.notify({
        type: 'error',
        message: 'invalid redirect URL or app code',
      })
      return
    }
    setIsLoading(true)
    if (protocol === SSOProtocol.SAML) {
      fetchMembersSAMLSSOUrl(appCode, redirectUrl).then((res) => {
        router.push(res.url)
      }).finally(() => {
        setIsLoading(false)
      })
    }
    else if (protocol === SSOProtocol.OIDC) {
      fetchMembersOIDCSSOUrl(appCode, redirectUrl).then((res) => {
        router.push(res.url)
      }).finally(() => {
        setIsLoading(false)
      })
    }
    else if (protocol === SSOProtocol.OAuth2) {
      fetchMembersOAuth2SSOUrl(appCode, redirectUrl).then((res) => {
        router.push(res.url)
      }).finally(() => {
        setIsLoading(false)
      })
    }
    else {
      Toast.notify({
        type: 'error',
        message: 'invalid SSO protocol',
      })
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
      <Lock01 className="mr-2 h-5 w-5 text-text-accent-light-mode-only" />
      <span className="truncate">{t('withSSO', { ns: 'login' })}</span>
    </Button>
  )
}

export default SSOAuth
