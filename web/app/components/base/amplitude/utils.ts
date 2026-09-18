import type { Types } from '@amplitude/analytics-browser'
import { getAnalyticsConsent } from '@/app/components/base/analytics-consent/consent-store'
import { getIsAmplitudeInitialized } from './init-state'
import { getBoundAmplitudeSdk } from './sdk-binding'

const canUseAmplitude = () => getAnalyticsConsent() === 'granted' && getIsAmplitudeInitialized()

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
  if (!canUseAmplitude()) return
  const amplitude = getBoundAmplitudeSdk()
  if (!amplitude) return
  if (eventOptions) return amplitude.track(eventName, eventProperties, eventOptions)
  return amplitude.track(eventName, eventProperties)
}

export const flushEvents = () => {
  if (!canUseAmplitude()) return
  const amplitude = getBoundAmplitudeSdk()
  if (!amplitude) return
  return amplitude.flush()
}

/**
 * Set user ID
 * @param userId User ID
 */
export const setUserId = (userId: string) => {
  if (!canUseAmplitude()) return
  const amplitude = getBoundAmplitudeSdk()
  if (!amplitude) return
  amplitude.setUserId(userId)
}

/**
 * Set user properties
 * @param properties User properties
 */
export const setUserProperties = (properties: Record<string, Types.ValidPropertyType>) => {
  if (!canUseAmplitude()) return
  const amplitude = getBoundAmplitudeSdk()
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
  if (!canUseAmplitude()) return
  const amplitude = getBoundAmplitudeSdk()
  if (!amplitude) return
  amplitude.reset()
}
