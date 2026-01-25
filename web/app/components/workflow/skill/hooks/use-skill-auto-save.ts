import { useEventListener, useUnmount } from 'ahooks'
import { useSkillSaveManager } from './use-skill-save-manager'

export function useSkillAutoSave(): void {
  const { saveAllDirty } = useSkillSaveManager()

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
