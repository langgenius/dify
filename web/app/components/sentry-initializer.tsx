'use client'

import type { ReactElement } from 'react'
import { IS_DEV } from '@/config'
import { env } from '@/env'
import dynamic from '@/next/dynamic'

const SentrySetup = dynamic(() => import('./sentry-setup'), { ssr: false })

const SentryInitializer = ({
  children,
}: { children: ReactElement }) => {
  const SENTRY_DSN = env.NEXT_PUBLIC_SENTRY_DSN

  return (
    <>
      {children}
      {!IS_DEV && SENTRY_DSN && <SentrySetup dsn={SENTRY_DSN} />}
    </>
  )
}

export default SentryInitializer
