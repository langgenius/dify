'use client'

import * as Sentry from '@sentry/react'
import { useEffect } from 'react'

import { IS_DEV } from '@/config'
import { env } from '@/env'

const SentryInitializer = ({
  children,
}: { children: React.ReactElement }) => {
  useEffect(() => {
    const sentryDsn = env.NEXT_PUBLIC_SENTRY_DSN
    if (!IS_DEV && sentryDsn) {
      Sentry.init({
        dsn: sentryDsn,
        integrations: [
          Sentry.browserTracingIntegration(),
          Sentry.replayIntegration(),
        ],
        tracesSampleRate: 0.1,
        replaysSessionSampleRate: 0.1,
        replaysOnErrorSampleRate: 1.0,
      })
    }
  }, [])
  return children
}

export default SentryInitializer
