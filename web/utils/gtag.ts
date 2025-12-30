/**
 * Send Google Analytics event
 * @param eventName - event name
 * @param eventParams - event params
 */
export const sendGAEvent = (
  eventName: string,
  eventParams?: GtagEventParams,
): void => {
  if (typeof window !== 'undefined' && window.gtag)
    window.gtag('event', eventName, eventParams)
}
