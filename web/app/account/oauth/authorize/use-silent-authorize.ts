import { toast } from '@langgenius/dify-ui/toast'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRouter } from '@/next/navigation'

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

type SilentAuthorizeOptions = {
  authAppInfo: { auto_authorize: boolean } | undefined
  authorize: (input: { body: { client_id: string } }) => Promise<{ code: string }>
  clientId: string
  hasOAuthParams: boolean
  isLoggedIn: boolean
  isProfileLoading: boolean
  redirectUri: string
  searchParams: { toString: () => string }
  state: string | null
}

/**
 * Skips the consent screen for first-party apps (e.g. the Dify Marketplace)
 * flagged with `auto_authorize` on their `oauth_provider_apps` row, as
 * returned by `POST /oauth/provider`. The flag is only a rendering hint:
 * issuing an authorization code still requires a logged-in console session,
 * so a tampered response only affects the tamperer's own UI.
 */
export function useSilentAuthorize({
  authAppInfo,
  authorize,
  clientId,
  hasOAuthParams,
  isLoggedIn,
  isProfileLoading,
  redirectUri,
  searchParams,
  state,
}: SilentAuthorizeOptions) {
  const { t } = useTranslation()
  const router = useRouter()
  const startedRef = useRef(false)
  const [autoAuthorizationFailed, setAutoAuthorizationFailed] = useState(false)
  const shouldAutoAuthorize = hasOAuthParams && Boolean(authAppInfo?.auto_authorize)

  useEffect(() => {
    if (!shouldAutoAuthorize || startedRef.current || isProfileLoading) return

    if (!isLoggedIn) {
      startedRef.current = true
      const returnUrl = buildReturnUrl('/account/oauth/authorize', `?${searchParams.toString()}`)
      router.replace(`/signin?redirect_url=${encodeURIComponent(returnUrl)}`)
      return
    }

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
    authorize,
    clientId,
    isLoggedIn,
    isProfileLoading,
    redirectUri,
    router,
    searchParams,
    shouldAutoAuthorize,
    state,
    t,
  ])

  return {
    isAutoAuthorizing: shouldAutoAuthorize && !autoAuthorizationFailed,
  }
}
