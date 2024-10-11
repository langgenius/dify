'use client'

import { SWRConfig } from 'swr'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

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
  const [init, setInit] = useState(false)

  useEffect(() => {
    if (!(consoleToken || refreshToken || consoleTokenFromLocalStorage))
      router.replace('/signin')

    if (consoleToken && refreshToken) {
      localStorage?.setItem('console_token', consoleToken!)
      localStorage?.setItem('refresh_token', refreshToken!)
      router.replace('/apps', { forceOptimisticNavigation: false } as any)
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
