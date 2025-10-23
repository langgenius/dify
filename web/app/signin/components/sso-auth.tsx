'use client'
import { useRouter, useSearchParams } from 'next/navigation'
import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Lock01 } from '@/app/components/base/icons/src/vender/solid/security'
import Toast from '@/app/components/base/toast'
import { getUserOAuth2SSOUrl, getUserOIDCSSOUrl, getUserSAMLSSOUrl } from '@/service/sso'
import Button from '@/app/components/base/button'
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
  const invite_token = decodeURIComponent(searchParams.get('invite_token') || '')

  const [isLoading, setIsLoading] = useState(false)

  const handleSSOLogin = () => {
    setIsLoading(true)
    if (protocol === SSOProtocol.SAML) {
      getUserSAMLSSOUrl(invite_token).then((res) => {
        router.push(res.url)
      }).finally(() => {
        setIsLoading(false)
      })
    }
    else if (protocol === SSOProtocol.OIDC) {
      getUserOIDCSSOUrl(invite_token).then((res) => {
        document.cookie = `user-oidc-state=${res.state};Path=/`
        router.push(res.url)
      }).finally(() => {
        setIsLoading(false)
      })
    }
    else if (protocol === SSOProtocol.OAuth2) {
      getUserOAuth2SSOUrl(invite_token).then((res) => {
        document.cookie = `user-oauth2-state=${res.state};Path=/`
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
      <Lock01 className='mr-2 h-5 w-5 text-text-accent-light-mode-only' />
      <span className="truncate">{t('login.withSSO')}</span>
    </Button>
  )
}

export default SSOAuth
