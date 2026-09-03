'use client'

import Cookies from 'js-cookie'
import { useEffect, useRef } from 'react'
import { useAnalyticsConsent } from '@/app/components/base/analytics-consent/consent-store'
import { useSearchParams } from '@/next/navigation'
import { sendGAEvent } from '@/utils/gtag'
import {
  clearOAuthRegistrationGAGuard,
  hasSentOAuthRegistrationGA,
  markOAuthRegistrationGASent,
} from './base/amplitude/registration-session-state'
import {
  normalizeRegistrationAttribution,
  rememberRegistrationSuccess,
} from './base/amplitude/registration-tracking'

const OAUTH_NEW_USER_PARAM = 'oauth_new_user'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const removeOAuthNewUserParam = () => {
  const url = new URL(window.location.href)
  url.searchParams.delete(OAUTH_NEW_USER_PARAM)
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
}

export function OAuthRegistrationAnalytics() {
  const analyticsConsent = useAnalyticsConsent()
  const searchParams = useSearchParams()
  const oauthNewUserParam = searchParams.get(OAUTH_NEW_USER_PARAM)
  const gaHandledRef = useRef(false)
  const amplitudeHandledRef = useRef(false)
  const cleanedRef = useRef(false)
  const utmInfoRef = useRef<ReturnType<typeof normalizeRegistrationAttribution> | undefined>(
    undefined,
  )

  useEffect(() => {
    if (oauthNewUserParam === null) {
      clearOAuthRegistrationGAGuard()
      return
    }

    const oauthNewUser = oauthNewUserParam === 'true'
    if (!oauthNewUser) {
      if (!cleanedRef.current) {
        cleanedRef.current = true
        clearOAuthRegistrationGAGuard()
        removeOAuthNewUserParam()
      }
      return
    }

    if (utmInfoRef.current === undefined) {
      let parsedUtmInfo: Record<string, unknown> | null = null
      const utmInfoStr = Cookies.get('utm_info')
      if (utmInfoStr) {
        try {
          const parsed: unknown = JSON.parse(utmInfoStr)
          if (isRecord(parsed)) parsedUtmInfo = parsed
        } catch (e) {
          console.error('Failed to parse utm_info cookie:', e)
        }
      }
      utmInfoRef.current = normalizeRegistrationAttribution(parsedUtmInfo)
    }
    const utmInfo = utmInfoRef.current

    const eventName = utmInfo ? 'user_registration_success_with_utm' : 'user_registration_success'

    if (!gaHandledRef.current) {
      gaHandledRef.current = true
      if (!hasSentOAuthRegistrationGA()) {
        sendGAEvent(eventName, {
          method: 'oauth',
          ...utmInfo,
        })
        markOAuthRegistrationGASent()
      }
    }

    if (
      (analyticsConsent === 'unknown' || analyticsConsent === 'granted') &&
      !amplitudeHandledRef.current
    ) {
      const persisted = rememberRegistrationSuccess({ method: 'oauth', utmInfo })
      if (!persisted) return
      amplitudeHandledRef.current = true
    }

    if (!cleanedRef.current) {
      cleanedRef.current = true
      Cookies.remove('utm_info')
      removeOAuthNewUserParam()
    }
  }, [analyticsConsent, oauthNewUserParam])

  return null
}
