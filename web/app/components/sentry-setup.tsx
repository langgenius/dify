'use client'

import * as Sentry from '@sentry/react'
import { useEffect } from 'react'

const SentrySetup = ({
  dsn,
}: {
  dsn: string
}) => {
  useEffect(() => {
    try {
      Sentry.init({
        dsn,
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
  }, [dsn])

  return null
}

export default SentrySetup
