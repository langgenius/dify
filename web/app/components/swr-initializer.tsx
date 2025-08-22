'use client'

import { SWRConfig } from 'swr'
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { fetchSetupStatus } from '@/service/common'
import {
  EDUCATION_VERIFYING_LOCALSTORAGE_ITEM,
  EDUCATION_VERIFY_URL_SEARCHPARAMS_ACTION,
} from '@/app/education-apply/constants'
import { resolvePostLoginRedirect } from '../signin/utils/post-login-redirect'

type SwrInitializerProps = {
  children: ReactNode
}
const SwrInitializer = ({
  children,
}: SwrInitializerProps) => {
  const router = useRouter()
  const searchParams = useSearchParams()
  const consoleToken = decodeURIComponent(searchParams.get('access_token') || '')
  const refreshToken = decodeURIComponent(searchParams.get('refresh_token') || '')
  // Tokens are now stored in cookies, no need to check localStorage
  // Keep these for backward compatibility check
  const consoleTokenFromLocalStorage = null
  const refreshTokenFromLocalStorage = null
  const pathname = usePathname()
  const [init, setInit] = useState(false)

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
      console.error(error)
      return false
    }
  }, [])

  useEffect(() => {
    (async () => {
      const action = searchParams.get('action')

      if (action === EDUCATION_VERIFY_URL_SEARCHPARAMS_ACTION)
        localStorage.setItem(EDUCATION_VERIFYING_LOCALSTORAGE_ITEM, 'yes')

      try {
        const isFinished = await isSetupFinished()
        if (!isFinished) {
          router.replace('/install')
          return
        }
        // With cookie-based auth, we don't need to check localStorage
        // If tokens are in URL params, backend should handle setting cookies
        if (searchParams.has('access_token') || searchParams.has('refresh_token')) {
          // Redirect to remove tokens from URL (backend will set cookies)
          const redirectUrl = resolvePostLoginRedirect(searchParams)
          if (redirectUrl)
            location.replace(redirectUrl)
          else
            router.replace(pathname)
        }

        setInit(true)
      }
      catch {
        router.replace('/signin')
      }
    })()
  }, [isSetupFinished, router, pathname, searchParams, consoleToken, refreshToken, consoleTokenFromLocalStorage, refreshTokenFromLocalStorage])

  return init
    ? (
      <SWRConfig value={{
        shouldRetryOnError: false,
        revalidateOnFocus: false,
        dedupingInterval: 60000,
        focusThrottleInterval: 5000,
        provider: () => new Map(),
      }}>
        {children}
      </SWRConfig>
    )
    : null
}

export default SwrInitializer
