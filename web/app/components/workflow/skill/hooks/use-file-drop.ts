'use client'

// Base drag-and-drop handler for file uploads
// Used by use-root-file-drop and use-folder-file-drop

import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import Toast from '@/app/components/base/toast'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { useUploadFileWithPresignedUrl } from '@/service/use-app-asset'
import { ROOT_ID } from '../constants'
import { prepareSkillUploadFile } from '../utils/skill-upload-utils'
import { useSkillTreeUpdateEmitter } from './use-skill-tree-collaboration'

type FileDropTarget = {
  folderId: string | null
  isFolder: boolean
}

export function useFileDrop() {
  const { t } = useTranslation('workflow')
  const appDetail = useAppStore(s => s.appDetail)
  const appId = appDetail?.id || ''
  const storeApi = useWorkflowStore()
  const uploadFile = useUploadFileWithPresignedUrl()
  const emitTreeUpdate = useSkillTreeUpdateEmitter()

  const handleDragOver = useCallback((e: React.DragEvent, target: FileDropTarget) => {
    e.preventDefault()
    e.stopPropagation()

    // Only handle file drops from the system (not internal tree drags)
    if (!e.dataTransfer.types.includes('Files'))
      return

    e.dataTransfer.dropEffect = 'copy'

    // Use ROOT_ID to indicate dragging over root (to distinguish from null = "not dragging")
    storeApi.getState().setCurrentDragType('upload')
    storeApi.getState().setDragOverFolderId(target.folderId ?? ROOT_ID)
  }, [storeApi])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()

    storeApi.getState().setCurrentDragType(null)
    storeApi.getState().setDragOverFolderId(null)
  }, [storeApi])

  const handleDrop = useCallback(async (e: React.DragEvent, targetFolderId: string | null) => {
    e.preventDefault()
    e.stopPropagation()

    storeApi.getState().setCurrentDragType(null)
    storeApi.getState().setDragOverFolderId(null)

    // Get files from dataTransfer, filter out directories (which have no type)
    const items = Array.from(e.dataTransfer.items || [])
    const files: File[] = []

    for (const item of items) {
      if (item.kind === 'file') {
        const entry = item.webkitGetAsEntry?.()
        // Skip directories - they have isDirectory = true
        if (entry?.isDirectory) {
          Toast.notify({
            type: 'error',
            message: t('skillSidebar.menu.folderDropNotSupported'),
          })
          continue
        }
        const file = item.getAsFile()
        if (file)
          files.push(file)
      }
    }

    if (files.length === 0)
      return

    try {
      const uploadFiles = await Promise.all(files.map(file => prepareSkillUploadFile(file)))
      await Promise.all(
        uploadFiles.map(file =>
          uploadFile.mutateAsync({
            appId,
            file,
            parentId: targetFolderId,
          }),
        ),
      )

      emitTreeUpdate()
      Toast.notify({
        type: 'success',
        message: t('skillSidebar.menu.filesUploaded', { count: files.length }),
      })
    }
    catch {
      Toast.notify({
        type: 'error',
        message: t('skillSidebar.menu.uploadError'),
      })
    }
  }, [appId, uploadFile, t, storeApi, emitTreeUpdate])

  return {
    handleDragOver,
    handleDragLeave,
    handleDrop,
    isUploading: uploadFile.isPending,
  }
}
