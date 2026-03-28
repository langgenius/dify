import type { WorkflowTheme } from '../theme'
import {
  useCallback,
  useSyncExternalStore,
} from 'react'
import {
  getWorkflowThemeFromStorage,
  WORKFLOW_THEME_CHANGE_EVENT,
} from '../theme'

export const useWorkflowTheme = () => {
  const subscribe = useCallback((onStoreChange: () => void) => {
    window.addEventListener('storage', onStoreChange)
    window.addEventListener(WORKFLOW_THEME_CHANGE_EVENT, onStoreChange)

    return () => {
      window.removeEventListener('storage', onStoreChange)
      window.removeEventListener(WORKFLOW_THEME_CHANGE_EVENT, onStoreChange)
    }
  }, [])

  const getSnapshot = useCallback((): WorkflowTheme => {
    return getWorkflowThemeFromStorage()
  }, [])

  const getServerSnapshot = useCallback((): WorkflowTheme => {
    return 'default'
  }, [])

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
