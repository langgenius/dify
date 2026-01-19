'use client'

import { useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import Toast from '@/app/components/base/toast'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { useCreateAppAssetFile } from '@/service/use-app-asset'

type FileDropTarget = {
  folderId: string | null
  isFolder: boolean
}

export function useFileDrop() {
  const { t } = useTranslation('workflow')
  const appDetail = useAppStore(s => s.appDetail)
  const appId = appDetail?.id || ''
  const storeApi = useWorkflowStore()
  const createFile = useCreateAppAssetFile()

  const expandTimerRef = useRef<NodeJS.Timeout | null>(null)

  const clearExpandTimer = useCallback(() => {
    if (expandTimerRef.current) {
      clearTimeout(expandTimerRef.current)
      expandTimerRef.current = null
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, target: FileDropTarget) => {
    e.preventDefault()
    e.stopPropagation()

    // Only handle file drops from the system (not internal tree drags)
    if (!e.dataTransfer.types.includes('Files'))
      return

    e.dataTransfer.dropEffect = 'copy'

    storeApi.getState().setDragOverFolderId(target.folderId)

    // Auto-expand closed folder after 2 seconds of hovering
    if (target.isFolder && target.folderId) {
      clearExpandTimer()
      expandTimerRef.current = setTimeout(() => {
        const expandedFolders = storeApi.getState().expandedFolderIds
        if (!expandedFolders.has(target.folderId!))
          storeApi.getState().toggleFolder(target.folderId!)
      }, 2000)
    }
  }, [storeApi, clearExpandTimer])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()

    clearExpandTimer()
    storeApi.getState().setDragOverFolderId(null)
  }, [clearExpandTimer, storeApi])

  const handleDrop = useCallback(async (e: React.DragEvent, targetFolderId: string | null) => {
    e.preventDefault()
    e.stopPropagation()

    clearExpandTimer()
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
      for (const file of files) {
        await createFile.mutateAsync({
          appId,
          name: file.name,
          file,
          parentId: targetFolderId,
        })
      }

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
  }, [appId, createFile, t, clearExpandTimer, storeApi])

  return {
    handleDragOver,
    handleDragLeave,
    handleDrop,
    isUploading: createFile.isPending,
  }
}
