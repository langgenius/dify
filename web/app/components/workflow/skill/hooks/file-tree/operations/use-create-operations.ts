'use client'

import type { StoreApi } from 'zustand'
import type { SkillEditorSliceShape } from '@/app/components/workflow/store/workflow/skill-editor/types'
import type { AppAssetNode, BatchUploadNodeInput } from '@/types/app-asset'
import { useCallback, useRef } from 'react'
import {
  useBatchUpload,
  useCreateAppAssetFolder,
  useUploadFileWithPresignedUrl,
} from '@/service/use-app-asset'
import { prepareSkillUploadFile } from '../../../utils/skill-upload-utils'
import { useSkillTreeUpdateEmitter } from '../data/use-skill-tree-collaboration'
import { uploadFilesWithStatus } from './upload-files-with-status'

type UseCreateOperationsOptions = {
  parentId: string | null
  appId: string
  storeApi: StoreApi<SkillEditorSliceShape>
  onClose: () => void
  onFilesUploaded?: (nodes: AppAssetNode[]) => void
}

const getRelativePath = (file: File) => {
  return (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
}

export function useCreateOperations({
  parentId,
  appId,
  storeApi,
  onClose,
  onFilesUploaded,
}: UseCreateOperationsOptions) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

  const { isPending: isCreateFolderPending } = useCreateAppAssetFolder()
  const { mutateAsync: uploadFileAsync, isPending: isUploadFilePending } = useUploadFileWithPresignedUrl()
  const { mutateAsync: batchUploadAsync, isPending: isBatchUploadPending } = useBatchUpload()
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
    let uploadedCount = 0

    try {
      const result = await uploadFilesWithStatus({
        files,
        appId,
        parentId,
        storeApi,
        uploadFile: uploadFileAsync,
      })
      uploadedCount = result.uploaded
      if (result.uploadedNodes.length > 0)
        onFilesUploaded?.(result.uploadedNodes)
    }
    catch {
      storeApi.getState().setUploadStatus('partial_error')
    }
    finally {
      if (uploadedCount > 0)
        emitTreeUpdate()
      e.target.value = ''
      onClose()
    }
  }, [appId, uploadFileAsync, onClose, onFilesUploaded, parentId, storeApi, emitTreeUpdate])

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

      await batchUploadAsync({
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
  }, [appId, batchUploadAsync, onClose, parentId, storeApi, emitTreeUpdate])

  return {
    fileInputRef,
    folderInputRef,
    isCreating: isUploadFilePending || isCreateFolderPending || isBatchUploadPending,
    handleNewFile,
    handleNewFolder,
    handleFileChange,
    handleFolderChange,
  }
}
