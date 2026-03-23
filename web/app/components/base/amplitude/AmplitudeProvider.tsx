'use client'

import type { Types } from '@amplitude/analytics-browser'
import type { FC } from 'react'
import * as React from 'react'
import { useEffect, useRef } from 'react'
import { AMPLITUDE_API_KEY, IS_CLOUD_EDITION } from '@/config'

export type IAmplitudeProps = {
  sessionReplaySampleRate?: number
}

// Check if Amplitude should be enabled
export const isAmplitudeEnabled = () => {
  return IS_CLOUD_EDITION && !!AMPLITUDE_API_KEY
}

// Map URL pathname to English page name for consistent Amplitude tracking
const getEnglishPageName = (pathname: string): string => {
  // Remove leading slash and get the first segment
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

// Enrichment plugin to override page title with English name for page view events
const pageNameEnrichmentPlugin = (): Types.EnrichmentPlugin => {
  return {
    name: 'page-name-enrichment',
    type: 'enrichment',
    setup: async () => undefined,
    execute: async (event: Types.Event) => {
      // Only modify page view events
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
  const initializedRef = useRef(false)

  useEffect(() => {
    // Only enable in Saas edition with valid API key
    if (!isAmplitudeEnabled() || initializedRef.current)
      return
    initializedRef.current = true

    void Promise.all([
      import('@amplitude/analytics-browser'),
      import('@amplitude/plugin-session-replay-browser'),
    ]).then(([amplitude, replay]) => {
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

        const sessionReplay = replay.sessionReplayPlugin({
          sampleRate: sessionReplaySampleRate,
        })
        amplitude.add(sessionReplay)
      }
      catch (error) {
        console.error('Failed to initialize Amplitude', error)
      }
    }).catch((error) => {
      console.error('Failed to load Amplitude modules', error)
    })
  }, [sessionReplaySampleRate])

  // This is a client component that renders nothing
  return null
}

export default React.memo(AmplitudeProvider)
