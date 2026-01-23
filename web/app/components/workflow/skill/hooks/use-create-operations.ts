'use client'

import type { StoreApi } from 'zustand'
import type { SkillEditorSliceShape } from '@/app/components/workflow/store/workflow/skill-editor/types'
import type { BatchUploadNodeInput } from '@/types/app-asset'
import { useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import Toast from '@/app/components/base/toast'
import {
  useBatchUpload,
  useCreateAppAssetFolder,
  useUploadFileWithPresignedUrl,
} from '@/service/use-app-asset'

type UseCreateOperationsOptions = {
  parentId: string | null
  appId: string
  storeApi: StoreApi<SkillEditorSliceShape>
  onClose: () => void
}

const getRelativePath = (file: File) => {
  return (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
}

export function useCreateOperations({
  parentId,
  appId,
  storeApi,
  onClose,
}: UseCreateOperationsOptions) {
  const { t } = useTranslation('workflow')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

  const createFolder = useCreateAppAssetFolder()
  const uploadFile = useUploadFileWithPresignedUrl()
  const batchUpload = useBatchUpload()

  const handleNewFile = useCallback(() => {
    storeApi.getState().startCreateNode('file', parentId)
    onClose()
  }, [onClose, parentId, storeApi])

  const handleNewFolder = useCallback(() => {
    storeApi.getState().startCreateNode('folder', parentId)
    onClose()
  }, [onClose, parentId, storeApi])

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) {
      onClose()
      return
    }

    try {
      await Promise.all(
        files.map(file =>
          uploadFile.mutateAsync({
            appId,
            file,
            parentId,
          }),
        ),
      )

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
    finally {
      e.target.value = ''
      onClose()
    }
  }, [appId, uploadFile, onClose, parentId, t])

  const handleFolderChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) {
      onClose()
      return
    }

    try {
      const fileMap = new Map<string, File>()
      const tree: BatchUploadNodeInput[] = []
      const folderMap = new Map<string, BatchUploadNodeInput>()

      for (const file of files) {
        const relativePath = getRelativePath(file)
        fileMap.set(relativePath, file)

        const parts = relativePath.split('/')
        let currentLevel = tree
        let currentPath = ''

        for (let i = 0; i < parts.length; i++) {
          const part = parts[i]
          const isLastPart = i === parts.length - 1
          currentPath = currentPath ? `${currentPath}/${part}` : part

          if (isLastPart) {
            currentLevel.push({
              name: part,
              node_type: 'file',
              size: file.size,
            })
          }
          else {
            let folder = folderMap.get(currentPath)
            if (!folder) {
              folder = {
                name: part,
                node_type: 'folder',
                children: [],
              }
              folderMap.set(currentPath, folder)
              currentLevel.push(folder)
            }
            currentLevel = folder.children!
          }
        }
      }

      await batchUpload.mutateAsync({
        appId,
        tree,
        files: fileMap,
        parentId,
      })

      Toast.notify({
        type: 'success',
        message: t('skillSidebar.menu.folderUploaded'),
      })
    }
    catch {
      Toast.notify({
        type: 'error',
        message: t('skillSidebar.menu.uploadError'),
      })
    }
    finally {
      e.target.value = ''
      onClose()
    }
  }, [appId, batchUpload, onClose, t])

  return {
    fileInputRef,
    folderInputRef,
    isCreating: uploadFile.isPending || createFolder.isPending || batchUpload.isPending,
    handleNewFile,
    handleNewFolder,
    handleFileChange,
    handleFolderChange,
  }
}
