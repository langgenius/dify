import { useCallback, useRef, useState } from 'react'
import { APP_PUBLISH_DRAFT_CHANGED } from '@/app/components/app/app-publisher/events'
import { useEventEmitterContextContext } from '@/context/event-emitter'

export function usePublishChangeTracking({
  appId,
  serverPublishedAt,
}: {
  appId: string
  serverPublishedAt?: number
}) {
  const { eventEmitter } = useEventEmitterContextContext()
  const trackingAppIdRef = useRef('')
  const [publishedAtOverride, setPublishedAtOverride] = useState({ appId, value: 0 })
  const [unpublishedChangesState, setUnpublishedChangesState] = useState({
    appId,
    value: false,
  })
  const latestPublishedAt =
    publishedAtOverride.appId === appId
      ? Math.max(serverPublishedAt || 0, publishedAtOverride.value)
      : serverPublishedAt
  const hasUnpublishedChanges =
    unpublishedChangesState.appId === appId && unpublishedChangesState.value

  const dispatchPublishDraftChanged = useCallback(() => {
    if (trackingAppIdRef.current !== appId) return
    eventEmitter?.emit({
      type: APP_PUBLISH_DRAFT_CHANGED,
      instanceId: appId,
    })
  }, [appId, eventEmitter])

  eventEmitter?.useSubscription((event) => {
    if (
      typeof event !== 'string' &&
      event.type === APP_PUBLISH_DRAFT_CHANGED &&
      event.instanceId === appId
    )
      setUnpublishedChangesState({ appId, value: true })
  })

  const resetUnpublishedChanges = useCallback(() => {
    setUnpublishedChangesState({ appId, value: false })
  }, [appId])

  const markPublished = useCallback(() => {
    setUnpublishedChangesState({ appId, value: false })
    setPublishedAtOverride({ appId, value: Math.floor(Date.now() / 1000) })
  }, [appId])

  const runWithoutTracking = useCallback(<Result>(callback: () => Result): Result => {
    const trackedAppId = trackingAppIdRef.current
    trackingAppIdRef.current = ''
    try {
      return callback()
    } finally {
      trackingAppIdRef.current = trackedAppId
    }
  }, [])

  const startTracking = useCallback(() => {
    trackingAppIdRef.current = appId
  }, [appId])

  const stopTracking = useCallback(() => {
    trackingAppIdRef.current = ''
  }, [])

  return {
    dispatchPublishDraftChanged,
    hasUnpublishedChanges,
    latestPublishedAt,
    markPublished,
    resetUnpublishedChanges,
    runWithoutTracking,
    startTracking,
    stopTracking,
  }
}
