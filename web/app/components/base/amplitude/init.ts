import { AMPLITUDE_API_KEY } from '@/config'

export type AmplitudeInitializationOptions = {
  sessionReplaySampleRate?: number
}

let isAmplitudeInitialized = false
let amplitude: ReturnType<typeof import('./runtime').initializeAmplitudeSDK> | undefined
let initialization: Promise<void> | undefined
let shouldOptOut = true

export const getAmplitudeClient = () => (isAmplitudeInitialized ? amplitude : undefined)
const initializationListeners = new Set<() => void>()

export const getIsAmplitudeInitialized = () => isAmplitudeInitialized

export const subscribeAmplitudeInitialization = (listener: () => void) => {
  initializationListeners.add(listener)
  return () => initializationListeners.delete(listener)
}

const notifyAmplitudeInitialized = () => {
  initializationListeners.forEach((listener) => listener())
}

async function initializeAmplitude(sessionReplaySampleRate: number) {
  const { initializeAmplitudeSDK } = await import('./runtime')

  // Consent or the owning layout may have changed while the chunk was loading.
  if (shouldOptOut) return

  amplitude = initializeAmplitudeSDK(AMPLITUDE_API_KEY, sessionReplaySampleRate)
  isAmplitudeInitialized = true
  notifyAmplitudeInitialized()
}

export const ensureAmplitudeInitialized = ({
  sessionReplaySampleRate = 0.5,
}: AmplitudeInitializationOptions = {}): Promise<void> => {
  if (!AMPLITUDE_API_KEY || isAmplitudeInitialized || shouldOptOut) return Promise.resolve()

  initialization ??= initializeAmplitude(sessionReplaySampleRate).finally(() => {
    initialization = undefined
  })
  return initialization
}

export const setAmplitudeOptOut = (optOut: boolean) => {
  shouldOptOut = optOut
  getAmplitudeClient()?.setOptOut(optOut)
}
