'use client'

import type { SsoProtocol } from '@dify/contracts/api/console/system-features/types.gen'
import type { FC } from 'react'
import { zSsoProtocol } from '@dify/contracts/api/console/system-features/zod.gen'
import { Button } from '@langgenius/dify-ui/button'
import { ORPCError } from '@orpc/client'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { toastRequestError } from '@/app/notifications/request-error'
import { useRouter, useSearchParams } from '@/next/navigation'
import { getUserOAuth2SSOUrl, getUserOIDCSSOUrl, getUserSAMLSSOUrl } from '@/service/sso'

type SSOAuthProps = {
  protocol: SsoProtocol
}

// A message from the server explains the failure better than the generic one.
const hasServerMessage = (error: unknown) =>
  error instanceof ORPCError &&
  error.status !== 401 &&
  ((typeof error.data?.message === 'string' && !!error.data.message) ||
    (typeof error.data?.error === 'string' && !!error.data.error))

const SSOAuth: FC<SSOAuthProps> = ({ protocol }) => {
  const router = useRouter()
  const { t } = useTranslation(['login'])
  const searchParams = useSearchParams()
  const invite_token = decodeURIComponent(searchParams.get('invite_token') || '')

  const [isLoading, setIsLoading] = useState(false)

  const handleSSOError = (error: unknown) => {
    if (hasServerMessage(error)) toastRequestError(error)
    else toast.error(t(($) => $['error.ssoFailed'], { ns: 'login' }))
  }

  const handleSSOLogin = () => {
    setIsLoading(true)
    if (protocol === zSsoProtocol.enum.saml) {
      getUserSAMLSSOUrl(invite_token)
        .then((res) => {
          router.push(res.url)
        })
        .catch(handleSSOError)
        .finally(() => {
          setIsLoading(false)
        })
    } else if (protocol === zSsoProtocol.enum.oidc) {
      getUserOIDCSSOUrl(invite_token)
        .then((res) => {
          document.cookie = `user-oidc-state=${res.state};Path=/`
          router.push(res.url)
        })
        .catch(handleSSOError)
        .finally(() => {
          setIsLoading(false)
        })
    } else if (protocol === zSsoProtocol.enum.oauth2) {
      getUserOAuth2SSOUrl(invite_token)
        .then((res) => {
          document.cookie = `user-oauth2-state=${res.state};Path=/`
          router.push(res.url)
        })
        .catch(handleSSOError)
        .finally(() => {
          setIsLoading(false)
        })
    } else {
      toast.error(t(($) => $['error.invalidSSOProtocol'], { ns: 'login' }))
      setIsLoading(false)
    }
  }

  return (
    <Button
      tabIndex={0}
      onClick={() => {
        handleSSOLogin()
      }}
      disabled={isLoading}
      className="w-full"
    >
      <span
        aria-hidden
        className="i-custom-vender-solid-security-lock-01 size-5 text-text-accent-light-mode-only"
      />
      <span className="truncate">{t(($) => $.withSSO, { ns: 'login' })}</span>
    </Button>
  )
}

export default SSOAuth
