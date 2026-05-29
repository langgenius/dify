'use client'

import Cookies from 'js-cookie'
import { parseAsBoolean, useQueryState } from 'nuqs'
import { useEffect } from 'react'
import { sendGAEvent } from '@/utils/gtag'
import { trackEvent } from './base/amplitude'

export function OAuthRegistrationAnalytics() {
  const [oauthNewUser, setOAuthNewUser] = useQueryState(
    'oauth_new_user',
    parseAsBoolean.withOptions({ history: 'replace' }),
  )

  useEffect(() => {
    if (oauthNewUser === null)
      return

    if (!oauthNewUser) {
      void setOAuthNewUser(null)
      return
    }

    let utmInfo: Record<string, unknown> | null = null
    const utmInfoStr = Cookies.get('utm_info')
    if (utmInfoStr) {
      try {
        const parsed: unknown = JSON.parse(utmInfoStr)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
          utmInfo = parsed as Record<string, unknown>
      }
      catch (e) {
        console.error('Failed to parse utm_info cookie:', e)
      }
    }

    const eventName = utmInfo ? 'user_registration_success_with_utm' : 'user_registration_success'

    trackEvent(eventName, {
      method: 'oauth',
      ...utmInfo,
    })

    sendGAEvent(eventName, {
      method: 'oauth',
      ...utmInfo,
    })

    Cookies.remove('utm_info')
    void setOAuthNewUser(null)
  }, [oauthNewUser, setOAuthNewUser])

  return null
}
