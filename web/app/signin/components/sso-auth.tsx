'use client'
import { useRouter, useSearchParams } from 'next/navigation'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Lock01 } from '@/app/components/base/icons/src/vender/solid/security'
import Toast from '@/app/components/base/toast'
import { getUserOAuth2SSOUrl, getUserOIDCSSOUrl, getUserSAMLSSOUrl } from '@/service/sso'
import Button from '@/app/components/base/button'

type SSOAuthProps = {
  protocol: string
}

const SSOAuth: FC<SSOAuthProps> = ({
  protocol,
}) => {
  const searchParams = useSearchParams()
  const consoleToken = searchParams.get('console_token')
  const message = searchParams.get('message')

  const router = useRouter()
  const { t } = useTranslation()

  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (consoleToken) {
      localStorage.setItem('console_token', consoleToken)
      router.replace('/apps')
    }

    if (message) {
      Toast.notify({
        type: 'error',
        message,
      })
    }
  }, [])

  const handleSSOLogin = () => {
    setIsLoading(true)
    if (protocol === 'saml') {
      getUserSAMLSSOUrl().then((res) => {
        router.push(res.url)
      }).finally(() => {
        setIsLoading(false)
      })
    }
    else if (protocol === 'oidc') {
      getUserOIDCSSOUrl().then((res) => {
        document.cookie = `user-oidc-state=${res.state}`
        router.push(res.url)
      }).finally(() => {
        setIsLoading(false)
      })
    }
    else if (protocol === 'oauth2') {
      getUserOAuth2SSOUrl().then((res) => {
        document.cookie = `user-oauth2-state=${res.state}`
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
      <Lock01 className='mr-2 w-5 h-5 text-text-accent-light-mode-only' />
      <span>{t('login.withSSO')}</span>
    </Button>
  )
}

export default SSOAuth
