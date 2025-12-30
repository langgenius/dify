'use client'

import type { ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import {
  EDUCATION_VERIFY_URL_SEARCHPARAMS_ACTION,
  EDUCATION_VERIFYING_LOCALSTORAGE_ITEM,
} from '@/app/education-apply/constants'
import { fetchSetupStatus } from '@/service/common'
import { resolvePostLoginRedirect } from '../signin/utils/post-login-redirect'

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
  }, [isSetupFinished, router, pathname, searchParams])

  return init ? children : null
}
