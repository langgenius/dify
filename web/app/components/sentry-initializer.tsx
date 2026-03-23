'use client'

import { useEffect } from 'react'

import { IS_DEV } from '@/config'
import { env } from '@/env'

const SentryInitializer = ({
  children,
}: { children: React.ReactElement }) => {
  useEffect(() => {
    const SENTRY_DSN = env.NEXT_PUBLIC_SENTRY_DSN
    if (IS_DEV || !SENTRY_DSN)
      return

    void import('@sentry/react').then((Sentry) => {
      Sentry.init({
        dsn: SENTRY_DSN,
        integrations: [
          Sentry.browserTracingIntegration(),
          Sentry.replayIntegration(),
        ],
        tracesSampleRate: 0.1,
        replaysSessionSampleRate: 0.1,
        replaysOnErrorSampleRate: 1.0,
      })
    })
  }, [])
  return children
}

export default SentryInitializer
