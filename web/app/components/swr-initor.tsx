'use client'

import { SWRConfig } from 'swr'
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { fetchSetupStatus } from '@/service/common'

type SwrInitorProps = {
  children: ReactNode
}
const SwrInitor = ({
  children,
}: SwrInitorProps) => {
  const router = useRouter()
  const searchParams = useSearchParams()
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
      try {
        const isFinished = await isSetupFinished()
        if (!isFinished) {
          router.replace('/install')
          return
        }
        if (searchParams.has('access_token') || searchParams.has('refresh_token')) {
          localStorage.setItem('console_token', searchParams.get('access_token'))
          localStorage.setItem('refresh_token', searchParams.get('refresh_token'))
          router.replace(pathname)
        }

        setInit(true)
      }
      catch (error) {
        router.replace('/signin')
      }
    })()
  }, [isSetupFinished, router, pathname, searchParams])

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
