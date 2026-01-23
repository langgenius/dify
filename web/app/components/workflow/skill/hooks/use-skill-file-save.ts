import type { TFunction } from 'i18next'
import type { StoreApi } from 'zustand'
import type { Shape } from '@/app/components/workflow/store'
import { useCallback, useEffect } from 'react'
import Toast from '@/app/components/base/toast'
import { useUpdateAppAssetFileContent } from '@/service/use-app-asset'

type UseSkillFileSaveParams = {
  appId: string
  activeTabId: string | null
  isEditable: boolean
  draftContent: string | undefined
  isMetadataDirty: boolean
  originalContent: string
  currentMetadata: Record<string, unknown> | undefined
  storeApi: StoreApi<Shape>
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
  draftContent,
  isMetadataDirty,
  originalContent,
  currentMetadata,
  storeApi,
  t,
}: UseSkillFileSaveParams): () => Promise<void> {
  const updateContent = useUpdateAppAssetFileContent()

  const handleSave = useCallback(async () => {
    if (!activeTabId || !appId || !isEditable)
      return

    if (draftContent === undefined && !isMetadataDirty)
      return

    try {
      await updateContent.mutateAsync({
        appId,
        nodeId: activeTabId,
        payload: {
          content: draftContent ?? originalContent,
          ...(currentMetadata ? { metadata: currentMetadata } : {}),
        },
      })
      storeApi.getState().clearDraftContent(activeTabId)
      storeApi.getState().clearDraftMetadata(activeTabId)
      Toast.notify({
        type: 'success',
        message: t('api.saved', { ns: 'common' }),
      })
    }
    catch (error) {
      Toast.notify({
        type: 'error',
        message: String(error),
      })
    }
  }, [activeTabId, appId, currentMetadata, draftContent, isMetadataDirty, isEditable, originalContent, storeApi, t, updateContent])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleSave])

  return handleSave
}
