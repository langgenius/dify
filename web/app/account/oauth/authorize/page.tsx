'use client'

import React, { useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import cn from '@/utils/classnames'
import Button from '@/app/components/base/button'
import Avatar from '@/app/components/base/avatar'
import { useAppContext } from '@/context/app-context'
import { useAuthorizeOAuthApp, useOAuthAppInfo } from '@/service/use-oauth-provider'
import Loading from '@/app/components/base/loading'
import {
  RiAccountCircleLine,
  RiGlobalLine,
  RiInfoCardLine,
  RiMailLine,
  RiTranslate2,
} from '@remixicon/react'

const SCOPE_ICON_MAP: Record<string, { icon: React.ComponentType<{ className?: string }>, label: string }> = {
  'read:name': {
    icon: RiInfoCardLine,
    label: 'Name',
  },
  'read:email': {
    icon: RiMailLine,
    label: 'Email',
  },
  'read:avatar': {
    icon: RiAccountCircleLine,
    label: 'Avatar',
  },
  'read:interface_language': {
    icon: RiTranslate2,
    label: 'Language Preference',
  },
  'read:timezone': {
    icon: RiGlobalLine,
    label: 'Timezone',
  },
}

const STORAGE_KEY = 'oauth_authorize_pending'

function buildReturnUrl(pathname: string, search: string) {
  try {
    const base = `${globalThis.location.origin}${pathname}${search}`
    return base
  }
  catch {
    return pathname + search
  }
}

export default function OAuthAuthorizePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const client_id = searchParams.get('client_id') || ''
  const redirect_uri = searchParams.get('redirect_uri') || ''
  const response_type = searchParams.get('response_type') || 'code'

  const { userProfile } = useAppContext()
  const { data: authAppInfo, isLoading, isError, error } = useOAuthAppInfo(client_id, redirect_uri, true)
  const { mutateAsync: authorize, isPending: authorizing } = useAuthorizeOAuthApp()

  const isLoggedIn = useMemo(() => {
    try {
      return Boolean(localStorage.getItem('console_token'))
    }
    catch { return false }
  }, [])

  const invalidParams = !client_id || !redirect_uri || response_type !== 'code'

  const onLoginClick = () => {
    try {
      const returnUrl = buildReturnUrl('/account/oauth/authorize', `?client_id=${encodeURIComponent(client_id)}&redirect_uri=${encodeURIComponent(redirect_uri)}`)
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ client_id, redirect_uri, returnUrl }))
      router.push(`/signin?redirect_url=${encodeURIComponent(returnUrl)}`)
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
    catch {
      // handled by global toast
    }
  }

  if (isLoading) {
    return (
      <div className='bg-background-default-subtle'>
        <Loading type='app' />
      </div>
    )
  }

  if (invalidParams || isError) {
    return (
      <div className={cn('mx-auto mt-8 w-full px-6 md:px-[108px]')}>
        <p className='body-md-regular mt-2 text-text-tertiary'>{(error as any)?.message || 'Invalid parameters'}</p>
      </div>
    )
  }

  return (
    <div className='bg-background-default-subtle'>
      {authAppInfo?.app_icon && (
        <div className='w-max rounded-2xl border-[0.5px] border-components-panel-border bg-text-primary-on-surface p-3 shadow-lg'>
          {/* <img src={authAppInfo.app_icon} alt='app icon' className='h-10 w-10 rounded' /> */}
          <img src={'https://cloud.dify.ai/console/api/workspaces/current/tool-provider/builtin/time/icon'} alt='app icon' className='h-10 w-10 rounded' />
        </div>
      )}

      <div className={`mb-4 mt-5 flex flex-col gap-2 ${isLoggedIn ? 'pb-2' : ''}`}>
        <div className='title-4xl-semi-bold'>
          {isLoggedIn && <div className='text-text-primary'>Connect to</div>}
          <div className='text-[var(--color-saas-dify-blue-inverted)]'>{authAppInfo?.app_label?.en_US || authAppInfo?.app_label?.zh_Hans || authAppInfo?.app_label?.ja_JP}</div>
          {!isLoggedIn && <div className='text-text-primary'>wants to access your Dify Cloud account</div>}
        </div>
        <div className='body-md-regular text-text-secondary'>{isLoggedIn ? `${authAppInfo?.app_label?.en_US} wants to access your Dify account` : 'Please log in to authorize'}</div>
      </div>

      {isLoggedIn && (
        <div className='flex items-center justify-between rounded-xl bg-background-section-burn p-3'>
          <div className='flex items-center gap-2.5'>
            <Avatar avatar={userProfile.avatar_url} name={userProfile.name} size={36} />
            <div>
              <div className='system-md-semi-bold text-text-secondary'>{userProfile.name}</div>
              <div className='system-xs-regular text-text-tertiary'>{userProfile.email}</div>
            </div>
          </div>
          <Button variant='tertiary' size='small' onClick={() => router.push('/signin')}>Switch account</Button>
        </div>
      )}

      {isLoggedIn && Boolean(authAppInfo?.scope) && (
        <div className='mt-2 flex flex-col gap-2.5 rounded-xl bg-background-section-burn px-[22px] py-5 text-text-secondary'>
          {authAppInfo!.scope.split(/\s+/).filter(Boolean).map((scope: string) => {
            const Icon = SCOPE_ICON_MAP[scope]
            return (
              <div key={scope} className='body-sm-medium flex items-center gap-2 text-text-secondary'>
                {Icon ? <Icon.icon className='h-4 w-4' /> : <RiAccountCircleLine className='h-4 w-4' />}
                {Icon.label}
              </div>
            )
          })}
        </div>
      )}

      <div className='flex flex-col items-center gap-2 pt-4'>
        {!isLoggedIn ? (
          <Button variant='primary' size='large' className='w-full' onClick={onLoginClick}>Login</Button>
        ) : (
          <>
            <Button variant='primary' size='large' className='w-full' onClick={onAuthorize} disabled={authorizing} loading={authorizing}>Authorize</Button>
            <Button size='large' className='w-full' onClick={() => router.push('/apps')}>Cancel</Button>
          </>
        )}
      </div>
      <div className='mt-4 py-2'>
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
      <div className='system-xs-regular mt-3 text-text-tertiary'>We respect your privacy and will only use this information to enhance your experience with our developer tools.</div>
    </div>
  )
}
