import type { WebAppEventName, WebAppEventProperties } from './web-app-event'
import { AMPLITUDE_API_KEY } from '@/config'

type WebAppAmplitudeClient = ReturnType<
  (typeof import('@amplitude/analytics-browser'))['createInstance']
>

let webAppAmplitude: WebAppAmplitudeClient | null = null
let webAppAmplitudeInitialization: Promise<WebAppAmplitudeClient | null> | null = null
let shouldWebAppAmplitudeOptOut = true

async function initializeWebAppAmplitude(): Promise<WebAppAmplitudeClient | null> {
  try {
    const { createInstance } = await import('@amplitude/analytics-browser')
    const client = createInstance()

    client.init(AMPLITUDE_API_KEY, {
      autocapture: false,
      defaultTracking: false,
      fetchRemoteConfig: false,
      instanceName: 'webapp',
    })
    client.setOptOut(shouldWebAppAmplitudeOptOut)
    webAppAmplitude = client

    return client
  } catch {
    webAppAmplitudeInitialization = null
    return null
  }
}

export function ensureWebAppAmplitudeInitialized() {
  if (!AMPLITUDE_API_KEY) return Promise.resolve(null)

  if (!webAppAmplitudeInitialization) webAppAmplitudeInitialization = initializeWebAppAmplitude()

  return webAppAmplitudeInitialization
}

export function setWebAppAmplitudeOptOut(optOut: boolean) {
  shouldWebAppAmplitudeOptOut = optOut
  webAppAmplitude?.setOptOut(optOut)
}

export async function sendWebAppAmplitudeEvent<EventName extends WebAppEventName>(
  eventName: EventName,
  properties: WebAppEventProperties[EventName],
) {
  if (shouldWebAppAmplitudeOptOut) return

  const client = await ensureWebAppAmplitudeInitialized()
  if (!client || shouldWebAppAmplitudeOptOut) return

  client.track(eventName, properties)
}
