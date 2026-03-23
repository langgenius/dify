'use client'

import type { ReactElement } from 'react'
import * as Sentry from '@sentry/react'
import { useEffect } from 'react'
import { IS_DEV } from '@/config'
import { env } from '@/env'

const SentryInitializer = ({
  children,
}: { children: ReactElement }) => {
  useEffect(() => {
    const SENTRY_DSN = env.NEXT_PUBLIC_SENTRY_DSN
    if (!IS_DEV && SENTRY_DSN) {
      try {
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
      catch (error) {
        console.error('Failed to initialize Sentry', error)
      }
    }
  }, [])
  return children
}

export default SentryInitializer
