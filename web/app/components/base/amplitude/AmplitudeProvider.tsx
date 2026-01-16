'use client'

import type { FC } from 'react'
import * as amplitude from '@amplitude/analytics-browser'
import { sessionReplayPlugin } from '@amplitude/plugin-session-replay-browser'
import * as React from 'react'
import { useEffect } from 'react'
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
const pageNameEnrichmentPlugin = (): amplitude.Types.EnrichmentPlugin => {
  return {
    name: 'page-name-enrichment',
    type: 'enrichment',
    setup: async () => undefined,
    execute: async (event: amplitude.Types.Event) => {
      // Only modify page view events
      if (event.event_type === '[Amplitude] Page Viewed' && event.event_properties) {
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
    // Only enable in Saas edition with valid API key
    if (!isAmplitudeEnabled())
      return

    // Initialize Amplitude
    amplitude.init(AMPLITUDE_API_KEY, {
      defaultTracking: {
        sessions: true,
        pageViews: true,
        formInteractions: true,
        fileDownloads: true,
        attribution: true,
      },
    })

    // Add page name enrichment plugin to override page title with English name
    amplitude.add(pageNameEnrichmentPlugin())

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
