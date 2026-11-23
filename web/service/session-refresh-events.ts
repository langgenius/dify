const sessionRefreshEvents = new EventTarget()
let sessionRefreshRevision = 0

export function getSessionRefreshRevision(): number {
  return sessionRefreshRevision
}

export function subscribeToSessionRefresh(listener: () => void): () => void {
  sessionRefreshEvents.addEventListener('refresh', listener)
  return () => sessionRefreshEvents.removeEventListener('refresh', listener)
}

export function notifySessionRefreshed(): void {
  sessionRefreshRevision += 1
  sessionRefreshEvents.dispatchEvent(new Event('refresh'))
}
