import type { LoroDraftIdentity } from '../collaboration/core/loro-draft-provider'
import { useAtomValue } from 'jotai'
import { useCallback, useSyncExternalStore } from 'react'
import { collaborationManager } from '../collaboration/core/collaboration-manager'
import { editorResourceAtom } from '../editor-resource/state'
import { useStore } from '../store'

const emptyHistory = { undo: [], redo: [] } as const

export function useCollaborativeHistoryAppId() {
  const resource = useAtomValue(editorResourceAtom)
  return resource.kind === 'app' && resource.collaborationEnabled ? resource.appId : undefined
}

export function stepDraftHistory(
  appId: string,
  identity: LoroDraftIdentity | undefined,
  steps: number,
  action: 'undo' | 'redo' | 'jump',
) {
  if (!identity || !collaborationManager.isDraftHistoryReady(appId, identity)) return
  let applied = 0
  while (applied < Math.abs(steps)) {
    if (!(steps < 0 ? collaborationManager.undo() : collaborationManager.redo())) break
    applied++
  }
  if (applied) collaborationManager.emitHistoryAction(action)
  return applied > 0
}

export function useCanvasDraftHistory() {
  const appId = useCollaborativeHistoryAppId()
  const identity = useStore((s) => s.loroDraft)
  const subscribe = useCallback(
    (refresh: () => void) => {
      if (!appId) return () => {}
      const offHistory = collaborationManager.onUndoRedoStateChange(refresh)
      const offReady = collaborationManager.onGraphReadyChange(refresh)
      return () => {
        offHistory()
        offReady()
      }
    },
    [appId],
  )
  const snapshot = useCallback(() => {
    if (!appId || collaborationManager.isLocalDraftFallback(appId)) return undefined
    return identity && collaborationManager.isDraftHistoryReady(appId, identity)
      ? collaborationManager.getDraftHistory()
      : emptyHistory
  }, [appId, identity])
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}
