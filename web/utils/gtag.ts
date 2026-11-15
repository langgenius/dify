import { isServer } from '@/utils/client'

/**
 * Send Google Analytics event
 * @param eventName - event name
 * @param eventParams - event params
 */
export const sendGAEvent = (eventName: string, eventParams?: GtagEventParams): void => {
  if (isServer || typeof window.gtag !== 'function') {
    return
  }
  window.gtag('event', eventName, eventParams)
}
