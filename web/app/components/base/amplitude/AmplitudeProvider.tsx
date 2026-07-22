'use client'

import type { AmplitudeInitializationOptions } from './init'
import { useEffect } from 'react'
import { useAnalyticsConsent } from '@/app/components/base/analytics-consent/consent-store'
import { ensureAmplitudeInitialized, setAmplitudeOptOut } from './init'

export type IAmplitudeProps = AmplitudeInitializationOptions & {
  active?: boolean
}

export function AmplitudeProvider({
  active = true,
  sessionReplaySampleRate = 0.5,
}: IAmplitudeProps) {
  const consent = useAnalyticsConsent()

  useEffect(() => {
    if (!active || consent !== 'granted') {
      setAmplitudeOptOut(true)
      return
    }

    ensureAmplitudeInitialized({
      sessionReplaySampleRate,
    })
    setAmplitudeOptOut(false)
  }, [active, consent, sessionReplaySampleRate])

  return null
}

export default AmplitudeProvider
