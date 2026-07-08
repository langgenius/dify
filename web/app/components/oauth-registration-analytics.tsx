'use client'

import Cookies from 'js-cookie'
import { useEffect, useRef } from 'react'
import { useSearchParams } from '@/next/navigation'
import { sendGAEvent } from '@/utils/gtag'
import { rememberRegistrationSuccess } from './base/amplitude/registration-tracking'

const OAUTH_NEW_USER_PARAM = 'oauth_new_user'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const removeOAuthNewUserParam = () => {
  const url = new URL(window.location.href)
  url.searchParams.delete(OAUTH_NEW_USER_PARAM)
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
}

export function OAuthRegistrationAnalytics() {
  const searchParams = useSearchParams()
  const oauthNewUserParam = searchParams.get(OAUTH_NEW_USER_PARAM)
  const handledParamRef = useRef<string | null>(null)

  useEffect(() => {
    if (oauthNewUserParam === null || handledParamRef.current === oauthNewUserParam)
      return

    handledParamRef.current = oauthNewUserParam
    const oauthNewUser = oauthNewUserParam === 'true'
    if (!oauthNewUser) {
      removeOAuthNewUserParam()
      return
    }

    let utmInfo: Record<string, unknown> | null = null
    const utmInfoStr = Cookies.get('utm_info')
    if (utmInfoStr) {
      try {
        const parsed: unknown = JSON.parse(utmInfoStr)
        if (isRecord(parsed))
          utmInfo = parsed
      }
      catch (e) {
        console.error('Failed to parse utm_info cookie:', e)
      }
    }

    const eventName = utmInfo ? 'user_registration_success_with_utm' : 'user_registration_success'

    // Defer the Amplitude event until the user ID is attached. It is flushed in
    // AppBootstrapEffects after setUserId runs. Firing it here would record it under an
    // anonymous Amplitude profile (no user ID set yet).
    rememberRegistrationSuccess({ method: 'oauth', utmInfo })

    sendGAEvent(eventName, {
      method: 'oauth',
      ...utmInfo,
    })

    Cookies.remove('utm_info')
    removeOAuthNewUserParam()
  }, [oauthNewUserParam])

  return null
}
