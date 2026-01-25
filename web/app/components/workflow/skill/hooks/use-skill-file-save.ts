import type { TFunction } from 'i18next'
import { useEventListener } from 'ahooks'
import { useCallback } from 'react'
import Toast from '@/app/components/base/toast'
import { useSkillSaveManager } from './use-skill-save-manager'

type UseSkillFileSaveParams = {
  appId: string
  activeTabId: string | null
  isEditable: boolean
  originalContent: string
  currentMetadata: Record<string, unknown> | undefined
  t: TFunction<'workflow'>
}

/**
 * Hook to handle file save logic and Ctrl+S keyboard shortcut.
 * Returns the save handler function.
 */
export function useSkillFileSave({
  appId,
  activeTabId,
  isEditable,
  originalContent,
  currentMetadata,
  t,
}: UseSkillFileSaveParams): () => Promise<void> {
  const { saveFile } = useSkillSaveManager()

  const handleSave = useCallback(async () => {
    if (!activeTabId || !appId || !isEditable)
      return

    const result = await saveFile(activeTabId, {
      fallbackContent: originalContent,
      fallbackMetadata: currentMetadata,
    })

    if (result.error) {
      Toast.notify({
        type: 'error',
        message: String(result.error),
      })
      return
    }

    if (result.saved) {
      Toast.notify({
        type: 'success',
        message: t('api.saved', { ns: 'common' }),
      })
    }
  }, [activeTabId, appId, currentMetadata, isEditable, originalContent, saveFile, t])

  useEventListener('keydown', (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault()
      handleSave()
    }
  }, { target: window })

  return handleSave
}
