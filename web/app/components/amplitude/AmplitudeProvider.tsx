'use client'

import type { FC } from 'react'
import React, { useEffect } from 'react'
import * as amplitude from '@amplitude/analytics-browser'
import { sessionReplayPlugin } from '@amplitude/plugin-session-replay-browser'

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

    const sessionReplay = sessionReplayPlugin({
      sampleRate: 0.1,
    })

    amplitude.add(sessionReplay)

    amplitude.init(apiKey, {
      defaultTracking: {
        sessions: true,
        pageViews: true,
        formInteractions: true,
        fileDownloads: true,
      },
      logLevel: amplitude.Types.LogLevel.Warn,
    })
  }, [apiKey])

  return null
}

export default React.memo(AmplitudeProvider)
