import type { Types } from '@amplitude/analytics-browser'
import type { WebAppEventName, WebAppEventProperties } from './web-app-event'
import { AMPLITUDE_API_KEY } from '@/config'

type WebAppAmplitudeClient = ReturnType<
  (typeof import('@amplitude/analytics-browser'))['createInstance']
>
type WebAppAmplitudeStorageProvider = NonNullable<Types.BrowserOptions['storageProvider']>

const webAppAmplitudeEventQueue = new Map<string, Types.Event[]>()

const webAppAmplitudeStorageProvider: WebAppAmplitudeStorageProvider = {
  async isEnabled() {
    return true
  },
  async get(key) {
    return webAppAmplitudeEventQueue.get(key)
  },
  async getRaw(key) {
    const value = webAppAmplitudeEventQueue.get(key)
    return value ? JSON.stringify(value) : undefined
  },
  async set(key, value) {
    webAppAmplitudeEventQueue.set(key, value)
  },
  async remove(key) {
    webAppAmplitudeEventQueue.delete(key)
  },
  async reset() {
    webAppAmplitudeEventQueue.clear()
  },
}

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
      flushQueueSize: 1,
      identityStorage: 'none',
      instanceName: 'webapp',
      optOut: shouldWebAppAmplitudeOptOut,
      storageProvider: webAppAmplitudeStorageProvider,
    })
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
