export type AmplitudeInitializationOptions = {
  sessionReplaySampleRate?: number
}

let isAmplitudeInitialized = false
const initializationListeners = new Set<() => void>()

export const getIsAmplitudeInitialized = () => isAmplitudeInitialized

export const setIsAmplitudeInitialized = (initialized: boolean) => {
  isAmplitudeInitialized = initialized
}

export const subscribeAmplitudeInitialization = (listener: () => void) => {
  initializationListeners.add(listener)
  return () => initializationListeners.delete(listener)
}

export const notifyAmplitudeInitialized = () => {
  initializationListeners.forEach((listener) => listener())
}
