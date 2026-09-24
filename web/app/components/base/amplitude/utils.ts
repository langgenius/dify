import type { Types } from '@amplitude/analytics-browser'
import { getAnalyticsConsent } from '@/app/components/base/analytics-consent/consent-store'
import { getAmplitudeClient } from './init'

const getConsentedClient = () =>
  getAnalyticsConsent() === 'granted' ? getAmplitudeClient() : undefined

/**
 * Track custom event
 * @param eventName Event name
 * @param eventProperties Event properties (optional)
 */
export const trackEvent = (
  eventName: string,
  eventProperties?: Record<string, unknown>,
  eventOptions?: Types.EventOptions,
) => {
  const amplitude = getConsentedClient()
  if (!amplitude) return
  if (eventOptions) return amplitude.track(eventName, eventProperties, eventOptions)
  return amplitude.track(eventName, eventProperties)
}

export const flushEvents = () => {
  const amplitude = getConsentedClient()
  if (!amplitude) return
  return amplitude.flush()
}

/**
 * Set user ID
 * @param userId User ID
 */
export const setUserId = (userId: string) => {
  const amplitude = getConsentedClient()
  if (!amplitude) return
  amplitude.setUserId(userId)
}

/**
 * Set user properties
 * @param properties User properties
 */
export const setUserProperties = (properties: Record<string, Types.ValidPropertyType>) => {
  const amplitude = getConsentedClient()
  if (!amplitude) return
  const identifyEvent = new amplitude.Identify()
  Object.entries(properties).forEach(([key, value]) => {
    identifyEvent.set(key, value)
  })
  amplitude.identify(identifyEvent)
}

/**
 * Reset user (e.g., when user logs out)
 */
export const resetUser = () => {
  const amplitude = getConsentedClient()
  if (!amplitude) return
  amplitude.reset()
}
