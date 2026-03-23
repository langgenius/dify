'use client'

import type { ReactElement } from 'react'
import dynamic from '@/next/dynamic'

const SentryInitializer = dynamic(() => import('./sentry-initializer'), { ssr: false })

const LazySentryInitializer = ({ children }: { children: ReactElement }) => {
  return <SentryInitializer>{children}</SentryInitializer>
}

export default LazySentryInitializer
