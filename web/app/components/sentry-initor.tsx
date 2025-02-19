'use client'

import { useEffect } from 'react'
import * as Sentry from '@sentry/react'
import { useTranslation } from 'react-i18next'
import Toast from './base/toast'
import { useDebounceEffect } from 'ahooks'

const isDevelopment = process.env.NODE_ENV === 'development'

const SentryInit = ({
  children,
}: { children: React.ReactElement }) => {
  const { t } = useTranslation()
  useDebounceEffect(() => {
    Toast.notify({
      type: 'warning',
      message: t('common.offlineNotice'),
      duration: 60000,
      className: 'fixed left-1/2 -translate-x-1/2 !w-[520px]',
    })
  }, [t])
  useEffect(() => {
    const SENTRY_DSN = document?.body?.getAttribute('data-public-sentry-dsn')
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
