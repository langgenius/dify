/**
 * Google Analytics event tracking utility function
 * Wraps gtag calls and automatically handles the case where gtag is not available
 */

type GtagEventParams = {
  [key: string]: any
}

/**
 * Send Google Analytics event
 * @param eventName - event name
 * @param eventParams - event params
 * @example
 * sendGAEvent('filter_workflow_status', {
 *   status: 'succeeded',
 *   status_name: 'Success'
 * })
 */
export const sendGAEvent = (
  eventName: string,
  eventParams?: GtagEventParams,
): void => {
  if (typeof window !== 'undefined' && window.gtag)
    window.gtag('event', eventName, eventParams)
}
