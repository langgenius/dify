'use client'

import dynamic from '@/next/dynamic'

const SentryInitializer = dynamic(() => import('./sentry-initializer'), { ssr: false })

const LazySentryInitializer = () => <SentryInitializer />

export default LazySentryInitializer
