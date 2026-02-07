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
import { prepareSkillUploadFile } from '../../../utils/skill-upload-utils'
import { useSkillTreeUpdateEmitter } from '../data/use-skill-tree-collaboration'

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
  const emitTreeUpdate = useSkillTreeUpdateEmitter()

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
    const progress = { uploaded: 0, failed: 0 }

    storeApi.getState().setUploadStatus('uploading')
    storeApi.getState().setUploadProgress({ uploaded: 0, total, failed: 0 })

    try {
      const uploadFiles = await Promise.all(files.map(file => prepareSkillUploadFile(file)))
      await Promise.all(
        uploadFiles.map(async (file) => {
          try {
            await uploadFile.mutateAsync({ appId, file, parentId })
            progress.uploaded++
          }
          catch {
            progress.failed++
          }
          storeApi.getState().setUploadProgress({ uploaded: progress.uploaded, total, failed: progress.failed })
        }),
      )

      storeApi.getState().setUploadStatus(progress.failed > 0 ? 'partial_error' : 'success')
      storeApi.getState().setUploadProgress({ uploaded: progress.uploaded, total, failed: progress.failed })
    }
    catch {
      storeApi.getState().setUploadStatus('partial_error')
    }
    finally {
      if (progress.uploaded > 0)
        emitTreeUpdate()
      e.target.value = ''
      onClose()
    }
  }, [appId, uploadFile, onClose, parentId, storeApi, emitTreeUpdate])

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
      emitTreeUpdate()
    }
    catch {
      storeApi.getState().setUploadStatus('partial_error')
    }
    finally {
      e.target.value = ''
      onClose()
    }
  }, [appId, batchUpload, onClose, parentId, storeApi, emitTreeUpdate])

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
