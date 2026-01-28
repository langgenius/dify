'use client'

import type { StoreApi } from 'zustand'
import type { SkillEditorSliceShape } from '@/app/components/workflow/store/workflow/skill-editor/types'
import type { BatchUploadNodeInput } from '@/types/app-asset'
import { useCallback, useRef } from 'react'
import {
  useBatchUpload,
  useCreateAppAssetFolder,
  useUploadFileWithPresignedUrl,
} from '@/service/use-app-asset'
import { prepareSkillUploadFile } from '../utils/skill-upload-utils'

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

    const total = files.length
    let uploaded = 0
    let failed = 0

    storeApi.getState().setUploadStatus('uploading')
    storeApi.getState().setUploadProgress({ uploaded: 0, total, failed: 0 })

    try {
      const uploadFiles = await Promise.all(files.map(file => prepareSkillUploadFile(file)))
      await Promise.all(
        uploadFiles.map(async (file) => {
          try {
            await uploadFile.mutateAsync({ appId, file, parentId })
            uploaded++
          }
          catch {
            failed++
          }
          storeApi.getState().setUploadProgress({ uploaded, total, failed })
        }),
      )

      storeApi.getState().setUploadStatus(failed > 0 ? 'partial_error' : 'success')
      storeApi.getState().setUploadProgress({ uploaded, total, failed })
    }
    catch {
      storeApi.getState().setUploadStatus('partial_error')
    }
    finally {
      e.target.value = ''
      onClose()
    }
  }, [appId, uploadFile, onClose, parentId, storeApi])

  const handleFolderChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) {
      onClose()
      return
    }

    storeApi.getState().setUploadStatus('uploading')
    storeApi.getState().setUploadProgress({ uploaded: 0, total: files.length, failed: 0 })

    try {
      const fileMap = new Map<string, File>()
      const tree: BatchUploadNodeInput[] = []
      const folderMap = new Map<string, BatchUploadNodeInput>()
      const uploadFiles = await Promise.all(files.map(async (file) => {
        const relativePath = getRelativePath(file)
        const uploadFile = await prepareSkillUploadFile(file)
        return { relativePath, uploadFile }
      }))

      for (const { relativePath, uploadFile } of uploadFiles) {
        fileMap.set(relativePath, uploadFile)

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
              size: uploadFile.size,
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
        onProgress: (uploaded, total) => {
          storeApi.getState().setUploadProgress({ uploaded, total, failed: 0 })
        },
      })

      storeApi.getState().setUploadStatus('success')
      storeApi.getState().setUploadProgress({ uploaded: files.length, total: files.length, failed: 0 })
    }
    catch {
      storeApi.getState().setUploadStatus('partial_error')
    }
    finally {
      e.target.value = ''
      onClose()
    }
  }, [appId, batchUpload, onClose, parentId, storeApi])

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
