'use client'

import type { ReactNode } from 'react'
import Cookies from 'js-cookie'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { parseAsString, useQueryState } from 'nuqs'
import { useCallback, useEffect, useState } from 'react'
import {
  EDUCATION_VERIFY_URL_SEARCHPARAMS_ACTION,
  EDUCATION_VERIFYING_LOCALSTORAGE_ITEM,
} from '@/app/education-apply/constants'
import { sendGAEvent } from '@/utils/gtag'
import { fetchSetupStatusWithCache } from '@/utils/setup-status'
import { resolvePostLoginRedirect } from '../signin/utils/post-login-redirect'
import { trackEvent } from './base/amplitude'

type AppInitializerProps = {
  children: ReactNode
}

export const AppInitializer = ({
  children,
}: AppInitializerProps) => {
  const router = useRouter()
  const searchParams = useSearchParams()
  // Tokens are now stored in cookies, no need to check localStorage
  const pathname = usePathname()
  const [init, setInit] = useState(false)
  const [oauthNewUser, setOauthNewUser] = useQueryState(
    'oauth_new_user',
    parseAsString.withOptions({ history: 'replace' }),
  )

  const isSetupFinished = useCallback(async () => {
    try {
      const setUpStatus = await fetchSetupStatusWithCache()
      return setUpStatus.step === 'finished'
    }
    catch (error) {
      console.error(error)
      return false
    }
  }, [])

  useEffect(() => {
    (async () => {
      const action = searchParams.get('action')

      if (oauthNewUser === 'true') {
        let utmInfo = null
        const utmInfoStr = Cookies.get('utm_info')
        if (utmInfoStr) {
          try {
            utmInfo = JSON.parse(utmInfoStr)
          }
          catch (e) {
            console.error('Failed to parse utm_info cookie:', e)
          }
        }

        // Track registration event with UTM params
        trackEvent(utmInfo ? 'user_registration_success_with_utm' : 'user_registration_success', {
          method: 'oauth',
          ...utmInfo,
        })

        sendGAEvent(utmInfo ? 'user_registration_success_with_utm' : 'user_registration_success', {
          method: 'oauth',
          ...utmInfo,
        })

        // Clean up: remove utm_info cookie and URL params
        Cookies.remove('utm_info')
        setOauthNewUser(null)
      }

      if (action === EDUCATION_VERIFY_URL_SEARCHPARAMS_ACTION)
        localStorage.setItem(EDUCATION_VERIFYING_LOCALSTORAGE_ITEM, 'yes')

      try {
        const isFinished = await isSetupFinished()
        if (!isFinished) {
          router.replace('/install')
          return
        }

        const redirectUrl = resolvePostLoginRedirect(searchParams)
        if (redirectUrl) {
          location.replace(redirectUrl)
          return
        }

        setInit(true)
      }
      catch {
        router.replace('/signin')
      }
    })()
  }, [isSetupFinished, router, pathname, searchParams, oauthNewUser, setOauthNewUser])

  return init ? children : null
}
