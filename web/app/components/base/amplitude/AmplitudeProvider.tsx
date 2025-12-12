'use client'

import type { FC } from 'react'
import React, { useEffect } from 'react'
import * as amplitude from '@amplitude/analytics-browser'
import { sessionReplayPlugin } from '@amplitude/plugin-session-replay-browser'
import { IS_CLOUD_EDITION } from '@/config'
import { DatasetAttr } from '@/types/feature'

export type IAmplitudeProps = {
  apiKey?: string
  sessionReplaySampleRate?: number
}

const getRuntimeAmplitudeApiKey = () => {
  const envKey = process.env.NEXT_PUBLIC_AMPLITUDE_API_KEY
  if (envKey) return envKey
  return globalThis.document?.body?.getAttribute(DatasetAttr.DATA_PUBLIC_AMPLITUDE_API_KEY) || ''
}

// Check if Amplitude should be enabled
export const isAmplitudeEnabled = (apiKey?: string) => {
  const key = apiKey ?? getRuntimeAmplitudeApiKey()
  return IS_CLOUD_EDITION && !!key
}

const AmplitudeProvider: FC<IAmplitudeProps> = ({
  apiKey = getRuntimeAmplitudeApiKey(),
  sessionReplaySampleRate = 1,
}) => {
  useEffect(() => {
    // Only enable in Saas edition with valid API key
    if (!isAmplitudeEnabled(apiKey))
      return

    // Initialize Amplitude
    amplitude.init(apiKey, {
      defaultTracking: {
        sessions: true,
        pageViews: true,
        formInteractions: true,
        fileDownloads: true,
      },
      // Enable debug logs in development environment
      logLevel: amplitude.Types.LogLevel.Warn,
    })

    // Add Session Replay plugin
    const sessionReplay = sessionReplayPlugin({
      sampleRate: sessionReplaySampleRate,
    })
    amplitude.add(sessionReplay)
  }, [])

  // This is a client component that renders nothing
  return null
}

export default React.memo(AmplitudeProvider)
