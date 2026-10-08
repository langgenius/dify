import type { Types } from '@amplitude/analytics-browser'
import * as amplitude from '@amplitude/analytics-browser'
import { sessionReplayPlugin } from '@amplitude/plugin-session-replay-browser'

// Map URL pathname to English page name for consistent Amplitude tracking
const getEnglishPageName = (pathname: string): string => {
  // Remove leading slash and get the first segment
  const segments = pathname.replace(/^\//, '').split('/')
  const firstSegment = segments[0] || 'home'

  const pageNameMap: Record<string, string> = {
    '': 'Home',
    apps: 'Studio',
    agents: 'Agents',
    datasets: 'Knowledge',
    explore: 'Explore',
    tools: 'Tools',
    account: 'Account',
    signin: 'Sign In',
    signup: 'Sign Up',
  }

  return pageNameMap[firstSegment] || firstSegment.charAt(0).toUpperCase() + firstSegment.slice(1)
}

// Enrichment plugin to override page title with English name for page view events
const createPageNameEnrichmentPlugin = (): Types.EnrichmentPlugin => {
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
        const pageUrl = event.event_properties['[Amplitude] Page URL']
        if (typeof pageUrl === 'string') {
          let eventPath: string
          try {
            eventPath = new URL(pageUrl).pathname
          } catch {
            return event
          }
          const appMatch = /\/app\/([^/]+)\/access-point\/?$/.exec(eventPath)
          if (appMatch) event.event_properties.app_id = appMatch[1]
          const agentMatch = /\/agents\/([^/]+)\/access\/?$/.exec(eventPath)
          if (agentMatch?.[1]) {
            try {
              const { getAgentAccessAppId } = await import('./access-point-page-properties')
              const appId = await getAgentAccessAppId(agentMatch[1])
              if (appId) event.event_properties.app_id = appId
            } catch {
              // Preserve the page view when the app identity cannot be resolved.
            }
          }
        }
      }
      return event
    },
  }
}

export function initializeAmplitudeSDK(apiKey: string, sessionReplaySampleRate: number) {
  amplitude.add(createPageNameEnrichmentPlugin())
  amplitude.init(apiKey, {
    defaultTracking: {
      sessions: true,
      pageViews: true,
      formInteractions: true,
      fileDownloads: true,
      attribution: true,
    },
  })
  amplitude.add(sessionReplayPlugin({ sampleRate: sessionReplaySampleRate }))
  amplitude.setOptOut(false)
  return {
    track: amplitude.track,
    flush: amplitude.flush,
    setUserId: amplitude.setUserId,
    Identify: amplitude.Identify,
    identify: amplitude.identify,
    reset: amplitude.reset,
    setOptOut: amplitude.setOptOut,
  }
}
