'use client'

import * as Sentry from '@sentry/react'
import { useEffect } from 'react'

import { IS_DEV } from '@/config'

const SentryInitializer = ({
  children,
}: { children: React.ReactElement }) => {
  useEffect(() => {
    const SENTRY_DSN = document?.body?.getAttribute('data-public-sentry-dsn')
    if (!IS_DEV && SENTRY_DSN) {
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
    }
  }, [])
  return children
}

export default SentryInitializer
