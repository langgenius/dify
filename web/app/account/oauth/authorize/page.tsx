'use client'

import { Avatar } from '@langgenius/dify-ui/avatar'
import { Button } from '@langgenius/dify-ui/button'
import { toast } from '@langgenius/dify-ui/toast'
import {
  RiAccountCircleLine,
  RiGlobalLine,
  RiInfoCardLine,
  RiMailLine,
  RiTranslate2,
} from '@remixicon/react'
import { skipToken, useMutation, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { useLanguage } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { MARKETPLACE_OAUTH_CLIENT_ID } from '@/config'
import { isLegacyBase401, userProfileQueryOptions } from '@/features/account-profile/client'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { useRouter, useSearchParams } from '@/next/navigation'
import { consoleQuery } from '@/service/client'
import { useLogout } from '@/service/use-common'

function buildReturnUrl(pathname: string, search: string) {
  try {
    const base = `${globalThis.location.origin}${pathname}${search}`
    return base
  } catch {
    return pathname + search
  }
}

function buildOAuthCallbackUrl(redirectUri: string, code: string, state: string | null) {
  const url = new URL(redirectUri)
  url.searchParams.set('code', code)
  if (state) url.searchParams.set('state', state)
  return url.toString()
}

export default function OAuthAuthorize() {
  const { t } = useTranslation()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())

  const SCOPE_INFO_MAP: Record<
    string,
    { icon: React.ComponentType<{ className?: string }>; label: string }
  > = {
    'read:name': {
      icon: RiInfoCardLine,
      label: t(($) => $['scopes.name'], { ns: 'oauth' }),
    },
    'read:email': {
      icon: RiMailLine,
      label: t(($) => $['scopes.email'], { ns: 'oauth' }),
    },
    'read:avatar': {
      icon: RiAccountCircleLine,
      label: t(($) => $['scopes.avatar'], { ns: 'oauth' }),
    },
    'read:interface_language': {
      icon: RiTranslate2,
      label: t(($) => $['scopes.languagePreference'], { ns: 'oauth' }),
    },
    'read:timezone': {
      icon: RiGlobalLine,
      label: t(($) => $['scopes.timezone'], { ns: 'oauth' }),
    },
  }

  const router = useRouter()
  const language = useLanguage()
  const searchParams = useSearchParams()
  const clientId = searchParams.get('client_id') || ''
  const redirectUri = searchParams.get('redirect_uri') || ''
  const state = searchParams.get('state')
  const hasOAuthParams = Boolean(clientId && redirectUri)
  // These public URL/config values only select the Marketplace UX. They are not credentials.
  const shouldAutoAuthorizeMarketplace =
    hasOAuthParams &&
    systemFeatures.deployment_edition === 'CLOUD' &&
    searchParams.get('flow') === 'marketplace' &&
    Boolean(MARKETPLACE_OAUTH_CLIENT_ID) &&
    clientId === MARKETPLACE_OAUTH_CLIENT_ID
  // Probe user profile. 401 stays as `error` (legitimate "not logged in" state),
  // other errors throw to the nearest error.tsx; jumpTo same-pathname guard in
  // service/base.ts prevents a redirect loop here.
  const {
    data: userProfileResp,
    isPending: isProfileLoading,
    error: profileError,
  } = useQuery({
    ...userProfileQueryOptions(),
    throwOnError: (err) => !isLegacyBase401(err),
  })
  const isLoggedIn = !!userProfileResp && !profileError
  const userProfile = userProfileResp?.profile
  const shouldLoadOAuthApp = hasOAuthParams && (!shouldAutoAuthorizeMarketplace || isLoggedIn)
  const {
    data: authAppInfo,
    isLoading: isOAuthLoading,
    isFetching: isOAuthFetching,
    isError: isOAuthError,
    refetch: refetchOAuthApp,
  } = useQuery(
    consoleQuery.oauth.provider.post.queryOptions({
      input: shouldLoadOAuthApp
        ? { body: { client_id: clientId, redirect_uri: redirectUri } }
        : skipToken,
      context: { silent: true },
    }),
  )
  const { mutateAsync: authorize, isPending: authorizing } = useMutation(
    consoleQuery.oauth.provider.authorize.post.mutationOptions(),
  )
  const { mutateAsync: logout } = useLogout()
  const authorizationStartedRef = useRef(false)
  const marketplaceFlowStartedRef = useRef(false)
  const [marketplaceAutoAuthorizationFailed, setMarketplaceAutoAuthorizationFailed] =
    useState(false)
  const localizedAppLabel =
    authAppInfo?.app_label[language] ?? authAppInfo?.app_label[language.replace('_', '-')]
  const englishAppLabel = authAppInfo?.app_label.en_US ?? authAppInfo?.app_label['en-US']
  const appLabel =
    (typeof localizedAppLabel === 'string' && localizedAppLabel) ||
    (typeof englishAppLabel === 'string' && englishAppLabel) ||
    t(($) => $.unknownApp, { ns: 'oauth' })

  const onLoginSwitchClick = async () => {
    try {
      const returnUrl = buildReturnUrl('/account/oauth/authorize', `?${searchParams.toString()}`)
      if (isLoggedIn) await logout()
      router.push(`/signin?redirect_url=${encodeURIComponent(returnUrl)}`)
    } catch {
      router.push('/signin')
    }
  }

  const onAuthorize = async () => {
    if (!clientId || !redirectUri || authorizationStartedRef.current) return
    authorizationStartedRef.current = true
    try {
      const { code } = await authorize({ body: { client_id: clientId } })
      globalThis.location.href = buildOAuthCallbackUrl(redirectUri, code, state)
    } catch (error: unknown) {
      authorizationStartedRef.current = false
      const message = error instanceof Error ? error.message : String(error)
      toast.error(`${t(($) => $['error.authorizeFailed'], { ns: 'oauth' })}: ${message}`)
    }
  }

  useEffect(() => {
    if (!shouldAutoAuthorizeMarketplace || marketplaceFlowStartedRef.current || isProfileLoading)
      return

    if (!isLoggedIn) {
      marketplaceFlowStartedRef.current = true
      const returnUrl = buildReturnUrl('/account/oauth/authorize', `?${searchParams.toString()}`)
      router.replace(`/signin?redirect_url=${encodeURIComponent(returnUrl)}`)
      return
    }

    if (isOAuthLoading || isOAuthError || !authAppInfo) return

    marketplaceFlowStartedRef.current = true
    void authorize({ body: { client_id: clientId } })
      .then(({ code }) => {
        globalThis.location.href = buildOAuthCallbackUrl(redirectUri, code, state)
      })
      .catch((error: unknown) => {
        setMarketplaceAutoAuthorizationFailed(true)
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
    shouldAutoAuthorizeMarketplace,
    state,
    t,
  ])

  if (!hasOAuthParams || isOAuthError) {
    return (
      <div className="flex flex-col gap-4 bg-background-default-subtle text-text-secondary">
        <div className="body-md-regular">
          {t(($) => $[hasOAuthParams ? 'error.authAppInfoFetchFailed' : 'error.invalidParams'], {
            ns: 'oauth',
          })}
        </div>
        {isOAuthError && (
          <Button
            variant="secondary"
            size="large"
            onClick={() => void refetchOAuthApp()}
            loading={isOAuthFetching}
          >
            {t(($) => $['operation.retry'], { ns: 'common' })}
          </Button>
        )}
      </div>
    )
  }

  const isMarketplaceAutoAuthorizing =
    shouldAutoAuthorizeMarketplace && !marketplaceAutoAuthorizationFailed
  if (isProfileLoading || isOAuthLoading || isMarketplaceAutoAuthorizing) {
    return (
      <div className="bg-background-default-subtle">
        <Loading type="app" />
      </div>
    )
  }

  return (
    <div className="bg-background-default-subtle">
      {authAppInfo?.app_icon && (
        <div className="w-max rounded-2xl border-[0.5px] border-components-panel-border bg-text-primary-on-surface p-3 shadow-lg">
          <img src={authAppInfo.app_icon} alt="app icon" className="size-10 rounded-sm" />
        </div>
      )}

      <div className={`mt-5 mb-4 flex flex-col gap-2 ${isLoggedIn ? 'pb-2' : ''}`}>
        <div className="title-4xl-semi-bold">
          {isLoggedIn && (
            <div className="text-text-primary">{t(($) => $.connect, { ns: 'oauth' })}</div>
          )}
          <div className="text-saas-dify-blue-inverted">{appLabel}</div>
          {!isLoggedIn && (
            <div className="text-text-primary">
              {t(($) => $['tips.notLoggedIn'], { ns: 'oauth' })}
            </div>
          )}
        </div>
        <div className="body-md-regular text-text-secondary">
          {isLoggedIn
            ? `${appLabel} ${t(($) => $['tips.loggedIn'], { ns: 'oauth' })}`
            : t(($) => $['tips.needLogin'], { ns: 'oauth' })}
        </div>
      </div>

      {isLoggedIn && userProfile && (
        <div className="flex items-center justify-between rounded-xl bg-background-section-burn-inverted p-3">
          <div className="flex items-center gap-2.5">
            <Avatar avatar={userProfile.avatar_url} name={userProfile.name} size="lg" />
            <div>
              <div className="system-md-semi-bold text-text-secondary">{userProfile.name}</div>
              <div className="system-xs-regular text-text-tertiary">{userProfile.email}</div>
            </div>
          </div>
          <Button variant="tertiary" size="small" onClick={onLoginSwitchClick}>
            {t(($) => $.switchAccount, { ns: 'oauth' })}
          </Button>
        </div>
      )}

      {isLoggedIn && Boolean(authAppInfo?.scope) && (
        <div className="mt-2 flex flex-col gap-2.5 rounded-xl bg-background-section-burn-inverted px-5.5 py-5 text-text-secondary">
          {authAppInfo!.scope
            .split(/\s+/)
            .filter(Boolean)
            .map((scope: string) => {
              const scopeInfo = SCOPE_INFO_MAP[scope]
              const ScopeIcon = scopeInfo?.icon ?? RiAccountCircleLine
              return (
                <div
                  key={scope}
                  className="flex items-center gap-2 body-sm-medium text-text-secondary"
                >
                  <ScopeIcon className="size-4" />
                  {scopeInfo?.label ?? scope}
                </div>
              )
            })}
        </div>
      )}

      <div className="flex flex-col items-center gap-2 pt-4">
        {!isLoggedIn ? (
          <Button variant="primary" size="large" className="w-full" onClick={onLoginSwitchClick}>
            {t(($) => $.login, { ns: 'oauth' })}
          </Button>
        ) : (
          <>
            <Button
              variant="primary"
              size="large"
              className="w-full"
              onClick={onAuthorize}
              disabled={!clientId || !redirectUri || isOAuthError || authorizing}
              loading={authorizing}
            >
              {t(($) => $.continue, { ns: 'oauth' })}
            </Button>
            <Button size="large" className="w-full" onClick={() => router.push('/apps')}>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </Button>
          </>
        )}
      </div>
      <div className="mt-4 py-2">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="400"
          height="1"
          viewBox="0 0 400 1"
          fill="none"
        >
          <path d="M0 0.5H400" stroke="url(#paint0_linear_2_5904)" />
          <defs>
            <linearGradient
              id="paint0_linear_2_5904"
              x1="400"
              y1="9.49584"
              x2="0.000228929"
              y2="9.17666"
              gradientUnits="userSpaceOnUse"
            >
              <stop stop-color="white" stop-opacity="0.01" />
              <stop offset="0.505" stop-color="#101828" stop-opacity="0.08" />
              <stop offset="1" stop-color="white" stop-opacity="0.01" />
            </linearGradient>
          </defs>
        </svg>
      </div>
      <div className="mt-3 system-xs-regular text-text-tertiary">
        {t(($) => $['tips.common'], { ns: 'oauth' })}
      </div>
    </div>
  )
}
