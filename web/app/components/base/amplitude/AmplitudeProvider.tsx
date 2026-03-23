'use client'

import type { Types } from '@amplitude/analytics-browser'
import type { FC } from 'react'
import * as amplitude from '@amplitude/analytics-browser'
import { sessionReplayPlugin } from '@amplitude/plugin-session-replay-browser'
import * as React from 'react'
import { useEffect } from 'react'
import { AMPLITUDE_API_KEY, IS_CLOUD_EDITION } from '@/config'

export type IAmplitudeProps = {
  sessionReplaySampleRate?: number
}

let initialized = false

// Check if Amplitude should be enabled
export const isAmplitudeEnabled = () => {
  return IS_CLOUD_EDITION && !!AMPLITUDE_API_KEY
}

// Map URL pathname to English page name for consistent Amplitude tracking
const getEnglishPageName = (pathname: string): string => {
  const segments = pathname.replace(/^\//, '').split('/')
  const firstSegment = segments[0] || 'home'

  const pageNameMap: Record<string, string> = {
    '': 'Home',
    'apps': 'Studio',
    'datasets': 'Knowledge',
    'explore': 'Explore',
    'tools': 'Tools',
    'account': 'Account',
    'signin': 'Sign In',
    'signup': 'Sign Up',
  }

  return pageNameMap[firstSegment] || firstSegment.charAt(0).toUpperCase() + firstSegment.slice(1)
}

const pageNameEnrichmentPlugin = (): Types.EnrichmentPlugin => {
  return {
    name: 'page-name-enrichment',
    type: 'enrichment',
    setup: async () => undefined,
    execute: async (event: Types.Event) => {
      if (event.event_type === '[Amplitude] Page Viewed' && event.event_properties) {
        /* v8 ignore next @preserve */
        const pathname = typeof window !== 'undefined' ? window.location.pathname : ''
        event.event_properties['[Amplitude] Page Title'] = getEnglishPageName(pathname)
      }
      return event
    },
  }
}

const AmplitudeProvider: FC<IAmplitudeProps> = ({
  sessionReplaySampleRate = 0.5,
}) => {
  useEffect(() => {
    if (!isAmplitudeEnabled() || initialized)
      return

    initialized = true

    try {
      amplitude.init(AMPLITUDE_API_KEY, {
        defaultTracking: {
          sessions: true,
          pageViews: true,
          formInteractions: true,
          fileDownloads: true,
          attribution: true,
        },
      })

      amplitude.add(pageNameEnrichmentPlugin())

      const sessionReplay = sessionReplayPlugin({
        sampleRate: sessionReplaySampleRate,
      })
      amplitude.add(sessionReplay)
    }
    catch (error) {
      console.error('Failed to initialize Amplitude', error)
    }
  }, [sessionReplaySampleRate])

  return null
}

export default React.memo(AmplitudeProvider)
