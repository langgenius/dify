import { useAtomValue, useSetAtom, useStore } from 'jotai'
import { useEffect, useEffectEvent, useRef } from 'react'
import { difyBuilderActiveSessionIdAtom, difyBuilderLifecycleControlAtom } from '../session/state'
import {
  getLifecycleStorageKey,
  getSessionStorageKey,
  parseStoredLifecycleControl,
} from './session-storage'

export const DifyBuilderSessionPersistence = ({
  appId,
  enabled,
  restore,
  tenantId,
  userId,
}: {
  appId?: string
  enabled: boolean
  restore: (sessionId: string) => Promise<boolean>
  tenantId?: string
  userId?: string
}) => {
  const activeSessionId = useAtomValue(difyBuilderActiveSessionIdAtom)
  const setActiveSessionId = useSetAtom(difyBuilderActiveSessionIdAtom)
  const jotaiStore = useStore()
  const storageKey = getSessionStorageKey(tenantId, userId, appId)
  const attemptedStorageKeyRef = useRef<string | null>(null)
  const persistedSessionIdRef = useRef<string | null>(null)
  const restoringRef = useRef(false)
  const restoreSession = useEffectEvent(restore)

  useEffect(() => {
    if (!enabled || !storageKey) return
    // Persist admission identities synchronously before the request can leave.
    // A pending operation becomes unknown on reload and is never replayed here.
    return jotaiStore.sub(difyBuilderLifecycleControlAtom, () => {
      const control = jotaiStore.get(difyBuilderLifecycleControlAtom)
      try {
        const key = getLifecycleStorageKey(storageKey)
        if (control) {
          window.sessionStorage.setItem(key, JSON.stringify(control))
          window.sessionStorage.setItem(storageKey, control.sessionId)
        } else window.sessionStorage.removeItem(key)
      } catch {
        // Retain the in-memory block when browser storage is unavailable.
      }
    })
  }, [enabled, jotaiStore, storageKey])

  useEffect(() => {
    if (!enabled || !storageKey || attemptedStorageKeyRef.current === storageKey) return
    attemptedStorageKeyRef.current = storageKey

    let storedSessionId: string | null = null
    try {
      storedSessionId = window.sessionStorage.getItem(storageKey)?.trim() || null
      const control = parseStoredLifecycleControl(
        window.sessionStorage.getItem(getLifecycleStorageKey(storageKey)),
      )
      if (control && (!storedSessionId || control.sessionId === storedSessionId)) {
        storedSessionId = control.sessionId
        jotaiStore.set(difyBuilderLifecycleControlAtom, control)
      }
    } catch {
      return
    }
    if (!storedSessionId) return

    persistedSessionIdRef.current = storedSessionId
    restoringRef.current = true
    let disposed = false
    setActiveSessionId(storedSessionId)
    void restoreSession(storedSessionId)
      .catch(() => undefined)
      .finally(() => {
        if (disposed) return
        restoringRef.current = false
        const currentSessionId = jotaiStore.get(difyBuilderActiveSessionIdAtom)
        try {
          if (currentSessionId) {
            window.sessionStorage.setItem(storageKey, currentSessionId)
            persistedSessionIdRef.current = currentSessionId
          } else if (window.sessionStorage.getItem(storageKey) === storedSessionId) {
            window.sessionStorage.removeItem(storageKey)
            persistedSessionIdRef.current = null
          }
        } catch {
          // Session persistence is optional and must not block Builder recovery.
        }
      })
    return () => {
      disposed = true
      attemptedStorageKeyRef.current = null
      restoringRef.current = false
    }
  }, [enabled, jotaiStore, setActiveSessionId, storageKey])

  useEffect(() => {
    if (!enabled || !storageKey || restoringRef.current) return
    try {
      if (activeSessionId) {
        window.sessionStorage.setItem(storageKey, activeSessionId)
        persistedSessionIdRef.current = activeSessionId
      } else if (persistedSessionIdRef.current) {
        window.sessionStorage.removeItem(storageKey)
        persistedSessionIdRef.current = null
      }
    } catch {
      // Session persistence is a recovery enhancement; storage failures must
      // not block the active Builder flow.
    }
  }, [activeSessionId, enabled, storageKey])

  return null
}
