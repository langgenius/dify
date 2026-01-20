'use client'

// Handles file/folder creation and upload operations

import type { StoreApi } from 'zustand'
import type { SkillEditorSliceShape } from '@/app/components/workflow/store/workflow/skill-editor/types'
import { useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import Toast from '@/app/components/base/toast'
import {
  useCreateAppAssetFile,
  useCreateAppAssetFolder,
} from '@/service/use-app-asset'

type UseCreateOperationsOptions = {
  parentId: string | null
  appId: string
  storeApi: StoreApi<SkillEditorSliceShape>
  onClose: () => void
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
  const createFile = useCreateAppAssetFile()

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
          createFile.mutateAsync({
            appId,
            name: file.name,
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
  }, [appId, createFile, onClose, parentId, t])

  const handleFolderChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) {
      onClose()
      return
    }

    try {
      const folders = new Set<string>()

      for (const file of files) {
        const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
        const parts = relativePath.split('/')

        if (parts.length > 1) {
          let folderPath = ''
          for (let i = 0; i < parts.length - 1; i++) {
            folderPath = folderPath ? `${folderPath}/${parts[i]}` : parts[i]
            folders.add(folderPath)
          }
        }
      }

      const sortedFolders = Array.from(folders).sort((a, b) => {
        return a.split('/').length - b.split('/').length
      })

      const folderIdMap = new Map<string, string | null>()
      folderIdMap.set('', parentId)

      for (const folderPath of sortedFolders) {
        const parts = folderPath.split('/')
        const folderName = parts[parts.length - 1]
        const parentPath = parts.slice(0, -1).join('/')
        const parentFolderId = folderIdMap.get(parentPath) ?? parentId

        const result = await createFolder.mutateAsync({
          appId,
          payload: {
            name: folderName,
            parent_id: parentFolderId,
          },
        })

        folderIdMap.set(folderPath, result.id)
      }

      for (const file of files) {
        const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
        const parts = relativePath.split('/')
        const parentPath = parts.length > 1 ? parts.slice(0, -1).join('/') : ''
        const targetParentId = folderIdMap.get(parentPath) ?? parentId

        await createFile.mutateAsync({
          appId,
          name: file.name,
          file,
          parentId: targetParentId,
        })
      }

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
  }, [appId, createFile, createFolder, onClose, parentId, t])

  return {
    fileInputRef,
    folderInputRef,
    isCreating: createFile.isPending || createFolder.isPending,
    handleNewFile,
    handleNewFolder,
    handleFileChange,
    handleFolderChange,
  }
}
