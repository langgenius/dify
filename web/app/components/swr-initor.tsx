'use client'

import { SWRConfig } from 'swr'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import useRefreshToken from '@/hooks/use-refresh-token'

type SwrInitorProps = {
  children: ReactNode
}
const SwrInitor = ({
  children,
}: SwrInitorProps) => {
  const router = useRouter()
  const searchParams = useSearchParams()
  const consoleToken = searchParams.get('access_token')
  const refreshToken = searchParams.get('refresh_token')
  const consoleTokenFromLocalStorage = localStorage?.getItem('console_token')
  const refreshTokenFromLocalStorage = localStorage?.getItem('refresh_token')
  const [init, setInit] = useState(false)
  const { getNewAccessToken } = useRefreshToken()

  useEffect(() => {
    if (!(consoleToken || refreshToken || consoleTokenFromLocalStorage || refreshTokenFromLocalStorage)) {
      router.replace('/signin')
      return
    }
    if (consoleTokenFromLocalStorage && refreshTokenFromLocalStorage)
      getNewAccessToken(consoleTokenFromLocalStorage, refreshTokenFromLocalStorage)

    if (consoleToken && refreshToken) {
      localStorage.setItem('console_token', consoleToken)
      localStorage.setItem('refresh_token', refreshToken)
      getNewAccessToken(consoleToken, refreshToken).then(() => {
        router.replace('/apps', { forceOptimisticNavigation: false } as any)
      }).catch(() => {
        router.replace('/signin')
      })
    }

    setInit(true)
  }, [])

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
