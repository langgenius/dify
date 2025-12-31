/**
 * Send Google Analytics event
 * @param eventName - event name
 * @param eventParams - event params
 */
export const sendGAEvent = (
  eventName: string,
  eventParams?: GtagEventParams,
): void => {
  if (typeof window === 'undefined' || typeof (window as any).gtag !== 'function') {
    return
  }
  (window as any).gtag('event', eventName, eventParams)
}
