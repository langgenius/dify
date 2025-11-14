'use client'

import type { FC } from 'react'
import React, { useEffect } from 'react'
import * as amplitude from '@amplitude/analytics-browser'

export type IAmplitudeProps = {
  apiKey?: string
}

const AmplitudeProvider: FC<IAmplitudeProps> = ({
  apiKey = '702e89332ab88a7f14e665f417244e9d',
}) => {
  useEffect(() => {
    // // Only enable in non-CE edition
    // if (IS_CE_EDITION) {
    //   console.warn('[Amplitude] Amplitude is disabled in CE edition')
    //   return
    // }

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

    // Log initialization success in development
    if (process.env.NODE_ENV === 'development')
      console.log('[Amplitude] Initialized successfully, API Key:', apiKey)
  }, [apiKey])

  // This is a client component that renders nothing
  return null
}

export default React.memo(AmplitudeProvider)
