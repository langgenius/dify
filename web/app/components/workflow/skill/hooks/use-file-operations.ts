'use client'

import type { NodeApi, TreeApi } from 'react-arborist'
import type { TreeNodeData } from '../type'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import Toast from '@/app/components/base/toast'
import { useWorkflowStore } from '@/app/components/workflow/store'
import {
  useCreateAppAssetFile,
  useCreateAppAssetFolder,
  useDeleteAppAssetNode,
} from '@/service/use-app-asset'
import { getAllDescendantFileIds } from '../utils/tree-utils'
import { useSkillAssetTreeData } from './use-skill-asset-tree'

type UseFileOperationsOptions = {
  nodeId?: string
  onClose: () => void
  treeRef?: React.RefObject<TreeApi<TreeNodeData> | null>
  node?: NodeApi<TreeNodeData>
}

export function useFileOperations({
  nodeId: explicitNodeId,
  onClose,
  treeRef,
  node,
}: UseFileOperationsOptions) {
  const nodeId = node?.data.id ?? explicitNodeId ?? ''
  const { t } = useTranslation('workflow')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const appDetail = useAppStore(s => s.appDetail)
  const appId = appDetail?.id || ''
  const storeApi = useWorkflowStore()

  const createFolder = useCreateAppAssetFolder()
  const createFile = useCreateAppAssetFile()
  const deleteNode = useDeleteAppAssetNode()
  const { data: treeData } = useSkillAssetTreeData()

  const parentId = nodeId === 'root' ? null : nodeId

  const handleNewFile = useCallback(async () => {
    // eslint-disable-next-line no-alert -- MVP: Using prompt for simplicity
    const fileName = window.prompt(t('skillSidebar.menu.newFilePrompt'))
    if (!fileName || !fileName.trim()) {
      onClose()
      return
    }

    try {
      const emptyBlob = new Blob([''], { type: 'text/plain' })
      const file = new File([emptyBlob], fileName.trim())

      await createFile.mutateAsync({
        appId,
        name: fileName.trim(),
        file,
        parentId,
      })

      Toast.notify({
        type: 'success',
        message: t('skillSidebar.menu.fileCreated'),
      })
    }
    catch {
      Toast.notify({
        type: 'error',
        message: t('skillSidebar.menu.createError'),
      })
    }
    finally {
      onClose()
    }
  }, [appId, createFile, onClose, parentId, t])

  const handleNewFolder = useCallback(async () => {
    // eslint-disable-next-line no-alert -- MVP: Using prompt for simplicity
    const folderName = window.prompt(t('skillSidebar.menu.newFolderPrompt'))
    if (!folderName || !folderName.trim()) {
      onClose()
      return
    }

    try {
      await createFolder.mutateAsync({
        appId,
        payload: {
          name: folderName.trim(),
          parent_id: parentId,
        },
      })

      Toast.notify({
        type: 'success',
        message: t('skillSidebar.menu.folderCreated'),
      })
    }
    catch {
      Toast.notify({
        type: 'error',
        message: t('skillSidebar.menu.createError'),
      })
    }
    finally {
      onClose()
    }
  }, [appId, createFolder, onClose, parentId, t])

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) {
      onClose()
      return
    }

    try {
      for (const file of files) {
        await createFile.mutateAsync({
          appId,
          name: file.name,
          file,
          parentId,
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

  const handleRename = useCallback(() => {
    if (treeRef?.current) {
      const targetNode = treeRef.current.get(nodeId)
      targetNode?.edit()
    }
    else if (node) {
      node.edit()
    }
    onClose()
  }, [nodeId, node, onClose, treeRef])

  const handleDeleteClick = useCallback(() => {
    setShowDeleteConfirm(true)
  }, [])

  const handleDeleteConfirm = useCallback(async () => {
    const isFolder = node?.data?.node_type === 'folder'
    try {
      const descendantFileIds = treeData?.children
        ? getAllDescendantFileIds(nodeId, treeData.children)
        : []

      await deleteNode.mutateAsync({ appId, nodeId })

      descendantFileIds.forEach((fileId) => {
        storeApi.getState().closeTab?.(fileId)
        storeApi.getState().clearDraftContent?.(fileId)
      })

      // Also close and clear the node itself if it's a file
      if (!isFolder) {
        storeApi.getState().closeTab?.(nodeId)
        storeApi.getState().clearDraftContent?.(nodeId)
      }

      Toast.notify({
        type: 'success',
        message: isFolder
          ? t('skillSidebar.menu.deleted')
          : t('skillSidebar.menu.fileDeleted'),
      })
    }
    catch {
      Toast.notify({
        type: 'error',
        message: isFolder
          ? t('skillSidebar.menu.deleteError')
          : t('skillSidebar.menu.fileDeleteError'),
      })
    }
    finally {
      setShowDeleteConfirm(false)
      onClose()
    }
  }, [appId, nodeId, node?.data?.node_type, deleteNode, storeApi, treeData?.children, onClose, t])

  const handleDeleteCancel = useCallback(() => {
    setShowDeleteConfirm(false)
  }, [])

  const isLoading = createFile.isPending || createFolder.isPending || deleteNode.isPending

  return {
    fileInputRef,
    folderInputRef,
    showDeleteConfirm,
    isLoading,
    isDeleting: deleteNode.isPending,
    handleNewFile,
    handleNewFolder,
    handleFileChange,
    handleFolderChange,
    handleRename,
    handleDeleteClick,
    handleDeleteConfirm,
    handleDeleteCancel,
  }
}
