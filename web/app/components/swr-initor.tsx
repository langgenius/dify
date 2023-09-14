'use client'

import { SWRConfig } from 'swr'
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
  const localJwtToken = localStorage.getItem('jwt-token')

  if (!(jwtToken || localJwtToken))
    router.replace('/signin')

  if (jwtToken) {
    localStorage.setItem('jwt-token', jwtToken!)
    router.replace('/apps')
  }

  return (
    <SWRConfig value={{
      shouldRetryOnError: false,
    }}>
      {children}
    </SWRConfig>
  )
}

export default SwrInitor
