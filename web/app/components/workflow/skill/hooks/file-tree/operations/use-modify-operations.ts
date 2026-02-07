'use client'

// Handles file/folder rename and delete operations

import type { NodeApi, TreeApi } from 'react-arborist'
import type { StoreApi } from 'zustand'
import type { TreeNodeData } from '../../../type'
import type { SkillEditorSliceShape } from '@/app/components/workflow/store/workflow/skill-editor/types'
import type { AppAssetTreeResponse } from '@/types/app-asset'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Toast from '@/app/components/base/toast'
import { useDeleteAppAssetNode } from '@/service/use-app-asset'
import { getAllDescendantFileIds } from '../../../utils/tree-utils'
import { useSkillTreeUpdateEmitter } from '../data/use-skill-tree-collaboration'

type UseModifyOperationsOptions = {
  nodeId: string
  node?: NodeApi<TreeNodeData>
  treeRef?: React.RefObject<TreeApi<TreeNodeData> | null>
  appId: string
  storeApi: StoreApi<SkillEditorSliceShape>
  treeData?: AppAssetTreeResponse
  onClose: () => void
}

export function useModifyOperations({
  nodeId,
  node,
  treeRef,
  appId,
  storeApi,
  treeData,
  onClose,
}: UseModifyOperationsOptions) {
  const { t } = useTranslation('workflow')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const deleteNode = useDeleteAppAssetNode()
  const emitTreeUpdate = useSkillTreeUpdateEmitter()

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
      emitTreeUpdate()

      descendantFileIds.forEach((fileId) => {
        storeApi.getState().closeTab(fileId)
        storeApi.getState().clearDraftContent(fileId)
      })

      // Also close and clear the node itself if it's a file
      if (!isFolder) {
        storeApi.getState().closeTab(nodeId)
        storeApi.getState().clearDraftContent(nodeId)
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
  }, [appId, nodeId, node?.data?.node_type, deleteNode, storeApi, treeData?.children, onClose, t, emitTreeUpdate])

  const handleDeleteCancel = useCallback(() => {
    setShowDeleteConfirm(false)
  }, [])

  return {
    showDeleteConfirm,
    isDeleting: deleteNode.isPending,
    handleRename,
    handleDeleteClick,
    handleDeleteConfirm,
    handleDeleteCancel,
  }
}
