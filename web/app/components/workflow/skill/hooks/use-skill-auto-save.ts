import { useEventListener, useUnmount } from 'ahooks'
import { useEffect, useRef } from 'react'
import { START_TAB_ID } from '../constants'
import { useSkillSaveManager } from './use-skill-save-manager'

type UseSkillAutoSaveParams = {
  activeTabId: string | null
}

export function useSkillAutoSave({
  activeTabId,
}: UseSkillAutoSaveParams): void {
  const { saveFile, saveAllDirty } = useSkillSaveManager()
  const prevActiveTabIdRef = useRef<string | null>(activeTabId)

  useEffect(() => {
    const prevActiveTabId = prevActiveTabIdRef.current
    if (prevActiveTabId && prevActiveTabId !== activeTabId && prevActiveTabId !== START_TAB_ID)
      void saveFile(prevActiveTabId)

    prevActiveTabIdRef.current = activeTabId
  }, [activeTabId, saveFile])

  useUnmount(() => {
    saveAllDirty()
  })

  useEventListener(
    'visibilitychange',
    () => {
      if (document.visibilityState === 'hidden')
        saveAllDirty()
    },
    { target: document },
  )

  useEventListener(
    'beforeunload',
    () => {
      saveAllDirty()
    },
    { target: window },
  )
}
