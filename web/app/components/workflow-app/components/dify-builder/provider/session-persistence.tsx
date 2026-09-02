import { useAtomValue, useSetAtom, useStore } from 'jotai'
import { useEffect, useRef } from 'react'
import { difyBuilderActiveSessionIdAtom } from '../session/state'
import { getSessionStorageKey } from './session-storage'

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

  useEffect(() => {
    if (!enabled || !storageKey || attemptedStorageKeyRef.current === storageKey) return
    attemptedStorageKeyRef.current = storageKey

    let storedSessionId: string | null = null
    try {
      storedSessionId = window.sessionStorage.getItem(storageKey)?.trim() || null
    } catch {
      return
    }
    if (!storedSessionId) return

    persistedSessionIdRef.current = storedSessionId
    restoringRef.current = true
    setActiveSessionId(storedSessionId)
    void restore(storedSessionId)
      .catch(() => undefined)
      .finally(() => {
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
  }, [enabled, jotaiStore, restore, setActiveSessionId, storageKey])

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
