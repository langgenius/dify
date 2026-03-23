'use client'

import { IS_DEV } from '@/config'
import { env } from '@/env'
import dynamic from '@/next/dynamic'

const SentryInitializer = dynamic(() => import('./sentry-initializer'), { ssr: false })

const LazySentryInitializer = () => {
  if (IS_DEV || !env.NEXT_PUBLIC_SENTRY_DSN)
    return null

  return <SentryInitializer />
}

export default LazySentryInitializer
