'use client'

import { useEffect } from 'react'
import * as Sentry from '@sentry/react'
import { env } from '@/env'

const isDevelopment = env.NEXT_PUBLIC_NODE_ENV === 'DEVELOPMENT'

const SentryInit = ({
  children,
}: { children: React.ReactElement }) => {
  useEffect(() => {
    const SENTRY_DSN = env.NEXT_PUBLIC_SENTRY_DSN
    if (!isDevelopment && SENTRY_DSN) {
      Sentry.init({
        dsn: SENTRY_DSN,
        integrations: [
          new Sentry.BrowserTracing({
          }),
          new Sentry.Replay(),
        ],
        tracesSampleRate: 0.1,
        replaysSessionSampleRate: 0.1,
        replaysOnErrorSampleRate: 1.0,
      })
    }
  }, [])
  return children
}

export default SentryInit
