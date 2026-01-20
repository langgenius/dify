'use client'

// Internal tree node move handler (drag-and-drop within tree)

import type { AppAssetTreeView } from '@/types/app-asset'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import Toast from '@/app/components/base/toast'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { useMoveAppAssetNode } from '@/service/use-app-asset'
import { INTERNAL_NODE_DRAG_TYPE, ROOT_ID } from '../constants'
import { findNodeById, isDescendantOf, toApiParentId } from '../utils/tree-utils'

type NodeMoveTarget = {
  folderId: string | null
  isFolder: boolean
}

type UseNodeMoveOptions = {
  treeChildren: AppAssetTreeView[]
}

export function useNodeMove({ treeChildren }: UseNodeMoveOptions) {
  const { t } = useTranslation('workflow')
  const appDetail = useAppStore(s => s.appDetail)
  const appId = appDetail?.id || ''
  const storeApi = useWorkflowStore()
  const moveNode = useMoveAppAssetNode()

  const handleDragStart = useCallback((e: React.DragEvent, nodeId: string) => {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData(INTERNAL_NODE_DRAG_TYPE, nodeId)
    storeApi.getState().setCurrentDragType('move')
  }, [storeApi])

  const handleDragEnd = useCallback(() => {
    storeApi.getState().setCurrentDragType(null)
    storeApi.getState().setDragOverFolderId(null)
  }, [storeApi])

  const handleDragOver = useCallback((e: React.DragEvent, target: NodeMoveTarget) => {
    e.preventDefault()
    e.stopPropagation()

    if (!e.dataTransfer.types.includes(INTERNAL_NODE_DRAG_TYPE))
      return

    e.dataTransfer.dropEffect = 'move'
    storeApi.getState().setDragOverFolderId(target.folderId ?? ROOT_ID)
  }, [storeApi])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    storeApi.getState().setDragOverFolderId(null)
  }, [storeApi])

  const handleDrop = useCallback(async (e: React.DragEvent, targetFolderId: string | null) => {
    e.preventDefault()
    e.stopPropagation()

    storeApi.getState().setDragOverFolderId(null)
    storeApi.getState().setCurrentDragType(null)

    const nodeId = e.dataTransfer.getData(INTERNAL_NODE_DRAG_TYPE)
    if (!nodeId)
      return

    // Prevent dropping node into itself
    if (nodeId === targetFolderId) {
      Toast.notify({
        type: 'error',
        message: t('skillSidebar.menu.cannotMoveToSelf'),
      })
      return
    }

    // Prevent circular move (dropping folder into its descendant)
    const draggedNode = findNodeById(treeChildren, nodeId)
    if (draggedNode?.node_type === 'folder' && targetFolderId) {
      if (isDescendantOf(targetFolderId, nodeId, treeChildren)) {
        Toast.notify({
          type: 'error',
          message: t('skillSidebar.menu.cannotMoveToDescendant'),
        })
        return
      }
    }

    try {
      await moveNode.mutateAsync({
        appId,
        nodeId,
        payload: { parent_id: toApiParentId(targetFolderId) },
      })

      Toast.notify({
        type: 'success',
        message: t('skillSidebar.menu.moved'),
      })
    }
    catch {
      Toast.notify({
        type: 'error',
        message: t('skillSidebar.menu.moveError'),
      })
    }
  }, [appId, moveNode, t, storeApi, treeChildren])

  return {
    handleDragStart,
    handleDragEnd,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    isMoving: moveNode.isPending,
  }
}
