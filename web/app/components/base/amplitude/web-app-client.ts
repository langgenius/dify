import type { WebAppEventName, WebAppEventProperties } from './web-app-event'
import * as amplitude from '@amplitude/analytics-browser'
import { AMPLITUDE_API_KEY } from '@/config'

const webAppAmplitude = amplitude.createInstance()
let isWebAppAmplitudeInitialized = false

export function ensureWebAppAmplitudeInitialized() {
  if (!AMPLITUDE_API_KEY || isWebAppAmplitudeInitialized) return

  isWebAppAmplitudeInitialized = true

  try {
    webAppAmplitude.init(AMPLITUDE_API_KEY, {
      autocapture: false,
      defaultTracking: false,
      fetchRemoteConfig: false,
      instanceName: 'webapp',
    })
  } catch (error) {
    isWebAppAmplitudeInitialized = false
    throw error
  }
}

export function setWebAppAmplitudeOptOut(optOut: boolean) {
  if (!AMPLITUDE_API_KEY || !isWebAppAmplitudeInitialized) return
  webAppAmplitude.setOptOut(optOut)
}

export function sendWebAppAmplitudeEvent<EventName extends WebAppEventName>(
  eventName: EventName,
  properties: WebAppEventProperties[EventName],
) {
  if (!AMPLITUDE_API_KEY || !isWebAppAmplitudeInitialized) return
  webAppAmplitude.track(eventName, properties)
}
