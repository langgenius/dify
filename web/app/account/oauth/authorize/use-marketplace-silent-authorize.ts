import { toast } from '@langgenius/dify-ui/toast'
import { skipToken, useMutation, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MARKETPLACE_OAUTH_CLIENT_ID } from '@/config'
import { isLegacyBase401, userProfileQueryOptions } from '@/features/account-profile/client'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { useRouter, useSearchParams } from '@/next/navigation'
import { consoleQuery } from '@/service/client'
import { buildOAuthCallbackUrl, buildReturnUrl } from './oauth-url'

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

/**
 * Silently completes the OAuth authorization for the first-party Marketplace
 * client on Cloud: anonymous users are sent to sign-in with a return URL, and
 * logged-in users are authorized without the consent screen.
 *
 * The hook reads the OAuth search params and fetches its own data. Every query
 * matches the authorize page's query keys, so React Query dedupes the requests
 * and both consumers share one cache entry.
 */
export function useMarketplaceSilentAuthorize() {
  const { t } = useTranslation()
  const router = useRouter()
  const searchParams = useSearchParams()
  const clientId = searchParams.get('client_id') || ''
  const redirectUri = searchParams.get('redirect_uri') || ''
  const state = searchParams.get('state')
  const hasOAuthParams = Boolean(clientId && redirectUri)

  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const {
    data: userProfileResp,
    isPending: isProfileLoading,
    error: profileError,
  } = useQuery({
    ...userProfileQueryOptions(),
    throwOnError: (err) => !isLegacyBase401(err),
  })
  const isLoggedIn = !!userProfileResp && !profileError

  const shouldAutoAuthorize =
    hasOAuthParams &&
    shouldSilentAuthorizeMarketplace({
      clientId,
      deploymentEdition: systemFeatures.deployment_edition,
    })
  // Same gating as the authorize page so both observers produce an identical
  // query input: skip the app info request while an anonymous user is about
  // to be redirected to sign-in.
  const shouldLoadOAuthApp = hasOAuthParams && (!shouldAutoAuthorize || isLoggedIn)
  const {
    data: authAppInfo,
    isLoading: isOAuthLoading,
    isError: isOAuthError,
  } = useQuery(
    consoleQuery.oauth.provider.post.queryOptions({
      input: shouldLoadOAuthApp
        ? { body: { client_id: clientId, redirect_uri: redirectUri } }
        : skipToken,
      context: { silent: true },
    }),
  )
  const { mutateAsync: authorize } = useMutation(
    consoleQuery.oauth.provider.authorize.post.mutationOptions(),
  )

  const startedRef = useRef(false)
  const [autoAuthorizationFailed, setAutoAuthorizationFailed] = useState(false)

  useEffect(() => {
    if (!shouldAutoAuthorize || startedRef.current || isProfileLoading) return

    if (!isLoggedIn) {
      startedRef.current = true
      const returnUrl = buildReturnUrl('/account/oauth/authorize', `?${searchParams.toString()}`)
      router.replace(`/signin?redirect_url=${encodeURIComponent(returnUrl)}`)
      return
    }

    // Safety invariant: silent authorization must stay behind the
    // `/oauth/provider` request. A present `authAppInfo` means the backend
    // has already validated this client_id/redirect_uri pair, so the silent
    // redirect below never sends an authorization code to an unverified
    // redirect_uri. Do not bypass this precondition.
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
