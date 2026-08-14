import { toast } from '@langgenius/dify-ui/toast'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MARKETPLACE_OAUTH_CLIENT_ID } from '@/config'
import { useRouter } from '@/next/navigation'

export function shouldSilentAuthorizeMarketplace({
  deploymentEdition,
  clientId,
}: {
  deploymentEdition: string | undefined
  clientId: string
}) {
  return (
    deploymentEdition === 'CLOUD' &&
    Boolean(MARKETPLACE_OAUTH_CLIENT_ID) &&
    clientId === MARKETPLACE_OAUTH_CLIENT_ID
  )
}

export function buildReturnUrl(pathname: string, search: string) {
  try {
    return `${globalThis.location.origin}${pathname}${search}`
  } catch {
    return pathname + search
  }
}

export function buildOAuthCallbackUrl(redirectUri: string, code: string, state: string | null) {
  const url = new URL(redirectUri)
  url.searchParams.set('code', code)
  if (state) url.searchParams.set('state', state)
  return url.toString()
}

type MarketplaceSilentAuthorizeOptions = {
  authAppInfo: unknown
  authorize: (input: { body: { client_id: string } }) => Promise<{ code: string }>
  clientId: string
  deploymentEdition: string | undefined
  hasOAuthParams: boolean
  isLoggedIn: boolean
  isOAuthError: boolean
  isOAuthLoading: boolean
  isProfileLoading: boolean
  redirectUri: string
  searchParams: { toString: () => string }
  state: string | null
}

export function useMarketplaceSilentAuthorize({
  authAppInfo,
  authorize,
  clientId,
  deploymentEdition,
  hasOAuthParams,
  isLoggedIn,
  isOAuthError,
  isOAuthLoading,
  isProfileLoading,
  redirectUri,
  searchParams,
  state,
}: MarketplaceSilentAuthorizeOptions) {
  const { t } = useTranslation()
  const router = useRouter()
  const startedRef = useRef(false)
  const [autoAuthorizationFailed, setAutoAuthorizationFailed] = useState(false)
  const shouldAutoAuthorize =
    hasOAuthParams && shouldSilentAuthorizeMarketplace({ clientId, deploymentEdition })

  useEffect(() => {
    if (!shouldAutoAuthorize || startedRef.current || isProfileLoading) return

    if (!isLoggedIn) {
      startedRef.current = true
      const returnUrl = buildReturnUrl('/account/oauth/authorize', `?${searchParams.toString()}`)
      router.replace(`/signin?redirect_url=${encodeURIComponent(returnUrl)}`)
      return
    }

    if (isOAuthLoading || isOAuthError || !authAppInfo) return

    startedRef.current = true
    void authorize({ body: { client_id: clientId } })
      .then(({ code }) => {
        globalThis.location.href = buildOAuthCallbackUrl(redirectUri, code, state)
      })
      .catch((error: unknown) => {
        setAutoAuthorizationFailed(true)
        const message = error instanceof Error ? error.message : String(error)
        toast.error(`${t(($) => $['error.authorizeFailed'], { ns: 'oauth' })}: ${message}`)
      })
  }, [
    authAppInfo,
    authorize,
    clientId,
    isLoggedIn,
    isOAuthError,
    isOAuthLoading,
    isProfileLoading,
    redirectUri,
    router,
    searchParams,
    shouldAutoAuthorize,
    state,
    t,
  ])

  return {
    isMarketplaceAutoAuthorizing: shouldAutoAuthorize && !autoAuthorizationFailed,
  }
}
