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
import { fetchSetupStatus } from '@/service/common'
import { sendGAEvent } from '@/utils/gtag'
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
      if (localStorage.getItem('setup_status') === 'finished')
        return true
      const setUpStatus = await fetchSetupStatus()
      if (setUpStatus.step !== 'finished') {
        localStorage.removeItem('setup_status')
        return false
      }
      localStorage.setItem('setup_status', 'finished')
      return true
    }
    catch (error) {
      console.error('Failed to check setup status:', error instanceof Error ? error.message : error)
      throw error
    }
  }, [])

  useEffect(() => {
    (async () => {
      try {
        const action = searchParams.get('action')

        if (oauthNewUser === 'true') {
          let utmInfo = null
          const utmInfoStr = Cookies.get('utm_info')
          if (utmInfoStr) {
            try {
              utmInfo = JSON.parse(utmInfoStr)
            }
            catch (e) {
              console.error('Failed to parse utm_info cookie:', e instanceof Error ? e.message : e)
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
      catch (error) {
        console.error('App initialization error:', error instanceof Error ? error.message : error)
        router.replace('/signin')
      }
    })().catch((error) => {
      console.error('Unhandled promise rejection in AppInitializer:', error instanceof Error ? error.message : error)
      router.replace('/signin')
    })
  }, [isSetupFinished, router, pathname, searchParams, oauthNewUser, setOauthNewUser])

  return init ? children : null
}
