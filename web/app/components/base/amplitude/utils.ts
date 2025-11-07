import * as amplitude from '@amplitude/analytics-browser'

/**
 * Track custom event
 * @param eventName Event name
 * @param eventProperties Event properties (optional)
 */
export const trackEvent = (eventName: string, eventProperties?: Record<string, any>) => {
  amplitude.track(eventName, eventProperties)
}

/**
 * Set user ID
 * @param userId User ID
 */
export const setUserId = (userId: string) => {
  if (!userId) {
    console.warn('[Amplitude] ⚠️ Cannot set empty user ID')
    return
  }

  if (process.env.NODE_ENV === 'development')
    console.log('[Amplitude] 👤 Setting User ID:', userId)

  amplitude.setUserId(userId)
}

/**
 * Set user properties
 * @param properties User properties
 */
export const setUserProperties = (properties: Record<string, any>) => {
  // Filter out undefined and null values
  const validProperties = Object.entries(properties).reduce((acc, [key, value]) => {
    if (value !== undefined && value !== null)
      acc[key] = value

    return acc
  }, {} as Record<string, any>)

  const identifyEvent = new amplitude.Identify()
  Object.entries(validProperties).forEach(([key, value]) => {
    identifyEvent.set(key, value)
  })

  const result = amplitude.identify(identifyEvent)

  result.promise.catch((err) => {
    console.error('[Amplitude] ❌ Failed to set user properties:', err)
  })
}

/**
 * Reset user (e.g., when user logs out)
 */
export const resetUser = () => {
  amplitude.reset()
}
