'use client'

import type { ReactNode } from 'react'
import Cookies from 'js-cookie'
import { useRouter, useSearchParams } from 'next/navigation'
import { parseAsString, useQueryState } from 'nuqs'
import { useEffect, useReducer, useRef } from 'react'
import {
  EDUCATION_VERIFY_URL_SEARCHPARAMS_ACTION,
  EDUCATION_VERIFYING_LOCALSTORAGE_ITEM,
} from '@/app/education-apply/constants'
import { useSetupStatusQuery } from '@/hooks/use-global-public'
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
  const [init, markInit] = useReducer(() => true, false)
  const { data: setupStatus } = useSetupStatusQuery()
  const [oauthNewUser, setOauthNewUser] = useQueryState(
    'oauth_new_user',
    parseAsString.withOptions({ history: 'replace' }),
  )
  const oauthTrackedRef = useRef(false)

  useEffect(() => {
    if (oauthNewUser !== 'true' || oauthTrackedRef.current)
      return
    oauthTrackedRef.current = true

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

    trackEvent(utmInfo ? 'user_registration_success_with_utm' : 'user_registration_success', {
      method: 'oauth',
      ...utmInfo,
    })

    sendGAEvent(utmInfo ? 'user_registration_success_with_utm' : 'user_registration_success', {
      method: 'oauth',
      ...utmInfo,
    })

    Cookies.remove('utm_info')
    // eslint-disable-next-line react-hooks-extra/no-direct-set-state-in-use-effect -- setOauthNewUser is from nuqs useQueryState, not useState
    setOauthNewUser(null)
  }, [oauthNewUser, setOauthNewUser])

  useEffect(() => {
    const action = searchParams.get('action')
    if (action === EDUCATION_VERIFY_URL_SEARCHPARAMS_ACTION)
      localStorage.setItem(EDUCATION_VERIFYING_LOCALSTORAGE_ITEM, 'yes')
  }, [searchParams])

  useEffect(() => {
    if (!setupStatus)
      return

    if (setupStatus.step !== 'finished') {
      router.replace('/install')
      return
    }

    const redirectUrl = resolvePostLoginRedirect(searchParams)
    if (redirectUrl) {
      location.replace(redirectUrl)
      return
    }

    markInit()
  }, [setupStatus, router, searchParams])

  return init ? children : null
}
