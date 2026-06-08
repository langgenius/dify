import * as amplitude from '@amplitude/analytics-browser'
import { sessionReplayPlugin } from '@amplitude/plugin-session-replay-browser'
import { AMPLITUDE_API_KEY, isAmplitudeEnabled } from '@/config'

export type AmplitudeInitializationOptions = {
  sessionReplaySampleRate?: number
}

let isAmplitudeInitialized = false

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
const createPageNameEnrichmentPlugin = (): amplitude.Types.EnrichmentPlugin => {
  return {
    name: 'page-name-enrichment',
    type: 'enrichment',
    setup: async () => undefined,
    execute: async (event: amplitude.Types.Event) => {
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

export const ensureAmplitudeInitialized = ({
  sessionReplaySampleRate = 0.5,
}: AmplitudeInitializationOptions = {}) => {
  if (!isAmplitudeEnabled || isAmplitudeInitialized)
    return

  isAmplitudeInitialized = true

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

    amplitude.add(createPageNameEnrichmentPlugin())
    amplitude.add(sessionReplayPlugin({
      sampleRate: sessionReplaySampleRate,
    }))
  }
  catch (error) {
    isAmplitudeInitialized = false
    throw error
  }
}

// Only used by unit tests to reset module-scoped initialization state.
export const resetAmplitudeInitializationForTests = () => {
  isAmplitudeInitialized = false
}
