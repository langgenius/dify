'use client'

import type { FC } from 'react'
import React, { useEffect } from 'react'
import * as amplitude from '@amplitude/analytics-browser'
import { sessionReplayPlugin } from '@amplitude/plugin-session-replay-browser'
import { IS_CLOUD_EDITION } from '@/config'

export type IAmplitudeProps = {
  apiKey?: string
  sessionReplaySampleRate?: number
}

const AmplitudeProvider: FC<IAmplitudeProps> = ({
  apiKey = process.env.NEXT_PUBLIC_AMPLITUDE_API_KEY ?? '',
  sessionReplaySampleRate = 1,
}) => {
  useEffect(() => {
    // Only enable in Saas edition
    if (!IS_CLOUD_EDITION)
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
