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
  const jwtToken = searchParams.get('jwt_token')
  const jwtTokenFromLocalStorage = localStorage?.getItem('jwt-token')
  const [init, setInit] = useState(false)

  useEffect(() => {
    if (!(jwtToken || jwtTokenFromLocalStorage))
      router.replace('/signin')

    if (jwtToken) {
      localStorage?.setItem('jwt-token', jwtToken!)
      router.replace('/apps', { forceOptimisticNavigation: false })
    }
    setInit(true)
  }, [])

  return init
    ? (
      <SWRConfig value={{
        shouldRetryOnError: false,
      }}>
        {children}
      </SWRConfig>
    )
    : null
}

export default SwrInitor
