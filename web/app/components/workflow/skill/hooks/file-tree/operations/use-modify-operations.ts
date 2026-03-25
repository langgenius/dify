'use client'

import type { NodeApi, TreeApi } from 'react-arborist'
// Handles file/folder rename and delete operations

import type { StoreApi } from 'zustand'
import type { TreeNodeData } from '../../../type'
import type { SkillEditorSliceShape } from '@/app/components/workflow/store/workflow/skill-editor/types'
import type { AppAssetTreeResponse } from '@/types/app-asset'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/components/base/ui/toast'
import { useDeleteAppAssetNode } from '@/service/use-app-asset'
import { getAllDescendantFileIds, isDescendantOf } from '../../../utils/tree-utils'
import { useSkillTreeUpdateEmitter } from '../data/use-skill-tree-collaboration'

type UseModifyOperationsOptions = {
  nodeId: string
  node?: NodeApi<TreeNodeData>
  treeRef?: React.RefObject<TreeApi<TreeNodeData> | null>
  nodeType?: TreeNodeData['node_type']
  appId: string
  storeApi: StoreApi<SkillEditorSliceShape>
  treeData?: AppAssetTreeResponse
  onClose: () => void
}

export function useModifyOperations({
  nodeId,
  node,
  treeRef,
  nodeType,
  appId,
  storeApi,
  treeData,
  onClose,
}: UseModifyOperationsOptions) {
  const { t } = useTranslation('workflow')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const { mutateAsync: deleteNodeAsync, isPending: isDeleting } = useDeleteAppAssetNode()
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
    const isFolder = (node?.data?.node_type ?? nodeType) === 'folder'
    try {
      const descendantFileIds = treeData?.children
        ? getAllDescendantFileIds(nodeId, treeData.children)
        : []
      const affectedFileIds = Array.from(new Set(
        isFolder ? descendantFileIds : [...descendantFileIds, nodeId],
      ))

      await deleteNodeAsync({ appId, nodeId })
      emitTreeUpdate()

      affectedFileIds.forEach((fileId) => {
        storeApi.getState().closeTab(fileId)
        storeApi.getState().clearDraftContent(fileId)
        storeApi.getState().clearFileMetadata(fileId)
      })

      const clipboard = storeApi.getState().clipboard
      if (clipboard) {
        const shouldClearClipboard = [...clipboard.nodeIds].some((clipboardNodeId) => {
          if (clipboardNodeId === nodeId)
            return true
          if (!isFolder || !treeData?.children)
            return false
          return isDescendantOf(clipboardNodeId, nodeId, treeData.children)
        })

        if (shouldClearClipboard)
          storeApi.getState().clearClipboard()
      }

      toast.success(
        isFolder
          ? t('skillSidebar.menu.deleted')
          : t('skillSidebar.menu.fileDeleted'),
      )
    }
    catch {
      toast.error(
        isFolder
          ? t('skillSidebar.menu.deleteError')
          : t('skillSidebar.menu.fileDeleteError'),
      )
    }
    finally {
      setShowDeleteConfirm(false)
      onClose()
    }
  }, [appId, nodeId, node?.data?.node_type, nodeType, deleteNodeAsync, storeApi, treeData?.children, onClose, t, emitTreeUpdate])

  const handleDeleteCancel = useCallback(() => {
    setShowDeleteConfirm(false)
  }, [])

  return {
    showDeleteConfirm,
    isDeleting,
    handleRename,
    handleDeleteClick,
    handleDeleteConfirm,
    handleDeleteCancel,
  }
}
