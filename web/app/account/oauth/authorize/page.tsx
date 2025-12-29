'use client'

import {
  RiAccountCircleLine,
  RiGlobalLine,
  RiInfoCardLine,
  RiMailLine,
  RiTranslate2,
} from '@remixicon/react'
import dayjs from 'dayjs'
import { useRouter, useSearchParams } from 'next/navigation'
import * as React from 'react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import Avatar from '@/app/components/base/avatar'
import Button from '@/app/components/base/button'
import Loading from '@/app/components/base/loading'
import Toast from '@/app/components/base/toast'
import { useLanguage } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { useAppContext } from '@/context/app-context'
import { useIsLogin } from '@/service/use-common'
import { useAuthorizeOAuthApp, useOAuthAppInfo } from '@/service/use-oauth'
import {
  OAUTH_AUTHORIZE_PENDING_KEY,
  OAUTH_AUTHORIZE_PENDING_TTL,
  REDIRECT_URL_KEY,
} from './constants'

function setItemWithExpiry(key: string, value: string, ttl: number) {
  const item = {
    value,
    expiry: dayjs().add(ttl, 'seconds').unix(),
  }
  localStorage.setItem(key, JSON.stringify(item))
}

function buildReturnUrl(pathname: string, search: string) {
  try {
    const base = `${globalThis.location.origin}${pathname}${search}`
    return base
  }
  catch {
    return pathname + search
  }
}

export default function OAuthAuthorize() {
  const { t } = useTranslation()

  const SCOPE_INFO_MAP: Record<string, { icon: React.ComponentType<{ className?: string }>, label: string }> = {
    'read:name': {
      icon: RiInfoCardLine,
      label: t('scopes.name', { ns: 'oauth' }),
    },
    'read:email': {
      icon: RiMailLine,
      label: t('scopes.email', { ns: 'oauth' }),
    },
    'read:avatar': {
      icon: RiAccountCircleLine,
      label: t('scopes.avatar', { ns: 'oauth' }),
    },
    'read:interface_language': {
      icon: RiTranslate2,
      label: t('scopes.languagePreference', { ns: 'oauth' }),
    },
    'read:timezone': {
      icon: RiGlobalLine,
      label: t('scopes.timezone', { ns: 'oauth' }),
    },
  }

  const router = useRouter()
  const language = useLanguage()
  const searchParams = useSearchParams()
  const client_id = decodeURIComponent(searchParams.get('client_id') || '')
  const redirect_uri = decodeURIComponent(searchParams.get('redirect_uri') || '')
  const { userProfile } = useAppContext()
  const { data: authAppInfo, isLoading: isOAuthLoading, isError } = useOAuthAppInfo(client_id, redirect_uri)
  const { mutateAsync: authorize, isPending: authorizing } = useAuthorizeOAuthApp()
  const hasNotifiedRef = useRef(false)

  const { isLoading: isIsLoginLoading, data: loginData } = useIsLogin()
  const isLoggedIn = loginData?.logged_in
  const isLoading = isOAuthLoading || isIsLoginLoading
  const onLoginSwitchClick = () => {
    try {
      const returnUrl = buildReturnUrl('/account/oauth/authorize', `?client_id=${encodeURIComponent(client_id)}&redirect_uri=${encodeURIComponent(redirect_uri)}`)
      setItemWithExpiry(OAUTH_AUTHORIZE_PENDING_KEY, returnUrl, OAUTH_AUTHORIZE_PENDING_TTL)
      router.push(`/signin?${REDIRECT_URL_KEY}=${encodeURIComponent(returnUrl)}`)
    }
    catch {
      router.push('/signin')
    }
  }

  const onAuthorize = async () => {
    if (!client_id || !redirect_uri)
      return
    try {
      const { code } = await authorize({ client_id })
      const url = new URL(redirect_uri)
      url.searchParams.set('code', code)
      globalThis.location.href = url.toString()
    }
    catch (err: any) {
      Toast.notify({
        type: 'error',
        message: `${t('error.authorizeFailed', { ns: 'oauth' })}: ${err.message}`,
      })
    }
  }

  useEffect(() => {
    const invalidParams = !client_id || !redirect_uri
    if ((invalidParams || isError) && !hasNotifiedRef.current) {
      hasNotifiedRef.current = true
      Toast.notify({
        type: 'error',
        message: invalidParams ? t('error.invalidParams', { ns: 'oauth' }) : t('error.authAppInfoFetchFailed', { ns: 'oauth' }),
        duration: 0,
      })
    }
  }, [client_id, redirect_uri, isError])

  if (isLoading) {
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
          <img src={authAppInfo.app_icon} alt="app icon" className="h-10 w-10 rounded" />
        </div>
      )}

      <div className={`mb-4 mt-5 flex flex-col gap-2 ${isLoggedIn ? 'pb-2' : ''}`}>
        <div className="title-4xl-semi-bold">
          {isLoggedIn && <div className="text-text-primary">{t('connect', { ns: 'oauth' })}</div>}
          <div className="text-[var(--color-saas-dify-blue-inverted)]">{authAppInfo?.app_label[language] || authAppInfo?.app_label?.en_US || t('unknownApp', { ns: 'oauth' })}</div>
          {!isLoggedIn && <div className="text-text-primary">{t('tips.notLoggedIn', { ns: 'oauth' })}</div>}
        </div>
        <div className="body-md-regular text-text-secondary">{isLoggedIn ? `${authAppInfo?.app_label[language] || authAppInfo?.app_label?.en_US || t('unknownApp', { ns: 'oauth' })} ${t('tips.loggedIn', { ns: 'oauth' })}` : t('tips.needLogin', { ns: 'oauth' })}</div>
      </div>

      {isLoggedIn && userProfile && (
        <div className="flex items-center justify-between rounded-xl bg-background-section-burn-inverted p-3">
          <div className="flex items-center gap-2.5">
            <Avatar avatar={userProfile.avatar_url} name={userProfile.name} size={36} />
            <div>
              <div className="system-md-semi-bold text-text-secondary">{userProfile.name}</div>
              <div className="system-xs-regular text-text-tertiary">{userProfile.email}</div>
            </div>
          </div>
          <Button variant="tertiary" size="small" onClick={onLoginSwitchClick}>{t('switchAccount', { ns: 'oauth' })}</Button>
        </div>
      )}

      {isLoggedIn && Boolean(authAppInfo?.scope) && (
        <div className="mt-2 flex flex-col gap-2.5 rounded-xl bg-background-section-burn-inverted px-[22px] py-5 text-text-secondary">
          {authAppInfo!.scope.split(/\s+/).filter(Boolean).map((scope: string) => {
            const Icon = SCOPE_INFO_MAP[scope]
            return (
              <div key={scope} className="body-sm-medium flex items-center gap-2 text-text-secondary">
                {Icon ? <Icon.icon className="h-4 w-4" /> : <RiAccountCircleLine className="h-4 w-4" />}
                {Icon.label}
              </div>
            )
          })}
        </div>
      )}

      <div className="flex flex-col items-center gap-2 pt-4">
        {!isLoggedIn
          ? (
              <Button variant="primary" size="large" className="w-full" onClick={onLoginSwitchClick}>{t('login', { ns: 'oauth' })}</Button>
            )
          : (
              <>
                <Button variant="primary" size="large" className="w-full" onClick={onAuthorize} disabled={!client_id || !redirect_uri || isError || authorizing} loading={authorizing}>{t('continue', { ns: 'oauth' })}</Button>
                <Button size="large" className="w-full" onClick={() => router.push('/apps')}>{t('operation.cancel', { ns: 'common' })}</Button>
              </>
            )}
      </div>
      <div className="mt-4 py-2">
        <svg xmlns="http://www.w3.org/2000/svg" width="400" height="1" viewBox="0 0 400 1" fill="none">
          <path d="M0 0.5H400" stroke="url(#paint0_linear_2_5904)" />
          <defs>
            <linearGradient id="paint0_linear_2_5904" x1="400" y1="9.49584" x2="0.000228929" y2="9.17666" gradientUnits="userSpaceOnUse">
              <stop stop-color="white" stop-opacity="0.01" />
              <stop offset="0.505" stop-color="#101828" stop-opacity="0.08" />
              <stop offset="1" stop-color="white" stop-opacity="0.01" />
            </linearGradient>
          </defs>
        </svg>
      </div>
      <div className="system-xs-regular mt-3 text-text-tertiary">{t('tips.common', { ns: 'oauth' })}</div>
    </div>
  )
}
