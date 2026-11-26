import { useSyncExternalStore } from 'react'
import { collaborationManager } from '../core/collaboration-manager'

const subscribe = (onChange: () => void) => collaborationManager.onHistoryChange(onChange)
const getSnapshot = () => collaborationManager.getHistoryState()

/** Undo history of the shared document; `active` is false while editing without collaboration. */
export const useCollaborativeHistory = () =>
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
