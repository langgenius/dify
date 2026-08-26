'use client'

import { useEffect } from 'react'
import { setAnalyticsConsent } from './consent-store'

export function AnalyticsDisabled() {
  useEffect(() => {
    setAnalyticsConsent('disabled')
  }, [])

  return null
}
