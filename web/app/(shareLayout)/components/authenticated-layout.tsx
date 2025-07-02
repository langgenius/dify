'use client'

import Loading from '@/app/components/base/loading'
import { useWebAppStore } from '@/context/web-app-context'
import React, { useEffect, useState } from 'react'

const AuthenticatedLayout = ({ children }: { children: React.ReactNode }) => {
  const shareCode = useWebAppStore(s => s.shareCode)
  const webAppAccessMode = useWebAppStore(s => s.webAppAccessMode)
  const [isLoading, setIsLoading] = useState(true)
  useEffect(() => {
    (async () => {
      try {
        setIsLoading(true)
      }
      catch (error) { console.error(error) }
      finally {
        setIsLoading(false)
      }
    })()
  }, [webAppAccessMode, shareCode])
  if (isLoading) {
    return <div className='flex h-full items-center justify-center'>
      <Loading />
    </div>
  }
  return <>{children}</>
}

export default React.memo(AuthenticatedLayout)
