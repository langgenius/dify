import { isServer } from '@/utils/client'

export const sendGAEvent = (eventName: string, eventParams?: GtagEventParams): void => {
  if (isServer || typeof window.gtag !== 'function') {
    return
  }
  window.gtag('event', eventName, eventParams)
}
