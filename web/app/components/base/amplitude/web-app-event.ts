export type WebAppEventProperties = {
  webapp_run: {
    app_mode: string
  }
}

export type WebAppEventName = keyof WebAppEventProperties

export type WebAppEventTracker = <EventName extends WebAppEventName>(
  eventName: EventName,
  properties: WebAppEventProperties[EventName],
) => void

let activeTracker: WebAppEventTracker | null = null

export function registerWebAppEventTracker(tracker: WebAppEventTracker) {
  activeTracker = tracker

  return () => {
    if (activeTracker === tracker) activeTracker = null
  }
}

export function trackWebAppEvent<EventName extends WebAppEventName>(
  eventName: EventName,
  properties: WebAppEventProperties[EventName],
) {
  activeTracker?.(eventName, properties)
}
