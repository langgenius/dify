'use client'

import { SWRConfig } from 'swr'
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import useRefreshToken from '@/hooks/use-refresh-token'
import { fetchSetupStatus } from '@/service/common'

type SwrInitorProps = {
  children: ReactNode
}
const SwrInitor = ({
  children,
}: SwrInitorProps) => {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { getNewAccessToken } = useRefreshToken()
  const consoleToken = searchParams.get('access_token')
  const refreshToken = searchParams.get('refresh_token')
  const consoleTokenFromLocalStorage = localStorage?.getItem('console_token')
  const refreshTokenFromLocalStorage = localStorage?.getItem('refresh_token')
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

  const setRefreshToken = useCallback(async () => {
    try {
      if (!(consoleToken || refreshToken || consoleTokenFromLocalStorage || refreshTokenFromLocalStorage))
        return Promise.reject(new Error('No token found'))

      if (consoleTokenFromLocalStorage && refreshTokenFromLocalStorage)
        await getNewAccessToken()

      if (consoleToken && refreshToken) {
        localStorage.setItem('console_token', consoleToken)
        localStorage.setItem('refresh_token', refreshToken)
        await getNewAccessToken()
      }
    }
    catch (error) {
      return Promise.reject(error)
    }
  }, [consoleToken, refreshToken, consoleTokenFromLocalStorage, refreshTokenFromLocalStorage, getNewAccessToken])

  useEffect(() => {
    (async () => {
      try {
        const isFinished = await isSetupFinished()
        if (!isFinished) {
          router.replace('/install')
          return
        }
        await setRefreshToken()
        setInit(true)
      }
      catch (error) {
        router.replace('/signin')
      }
    })()
  }, [isSetupFinished, setRefreshToken, router])

  return init
    ? (
      <SWRConfig value={{
        shouldRetryOnError: false,
        revalidateOnFocus: false,
      }}>
        {children}
      </SWRConfig>
    )
    : null
}

export default SwrInitor
