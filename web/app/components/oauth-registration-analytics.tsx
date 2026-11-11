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
import { rememberRegistrationSuccess } from './base/amplitude/registration-tracking'
import {
  OAUTH_NEW_USER_PARAM,
  readOAuthRegistrationAttribution,
} from './oauth-registration-attribution'

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
  const utmInfoRef = useRef<ReturnType<typeof readOAuthRegistrationAttribution> | undefined>(
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
      utmInfoRef.current = readOAuthRegistrationAttribution({
        cookieValue: Cookies.get('utm_info'),
        searchParams,
      })
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
  }, [analyticsConsent, oauthNewUserParam, searchParams])

  return null
}
