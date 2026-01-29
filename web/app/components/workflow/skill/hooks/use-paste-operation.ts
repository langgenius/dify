'use client'

import type { RefObject } from 'react'
import type { TreeApi } from 'react-arborist'
import type { TreeNodeData } from '../type'
import type { AppAssetTreeResponse } from '@/types/app-asset'
import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import Toast from '@/app/components/base/toast'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { useMoveAppAssetNode } from '@/service/use-app-asset'
import { findNodeById, getTargetFolderIdFromSelection, toApiParentId } from '../utils/tree-utils'
import { useSkillTreeUpdateEmitter } from './use-skill-tree-collaboration'

type UsePasteOperationOptions = {
  treeRef: RefObject<TreeApi<TreeNodeData> | null>
  treeData?: AppAssetTreeResponse
  enabled?: boolean
}

type UsePasteOperationReturn = {
  isPasting: boolean
  handlePaste: () => void
}

export function usePasteOperation({
  treeRef,
  treeData,
  enabled = true,
}: UsePasteOperationOptions): UsePasteOperationReturn {
  const { t } = useTranslation('workflow')
  const storeApi = useWorkflowStore()
  const appDetail = useAppStore(s => s.appDetail)
  const appId = appDetail?.id || ''
  const moveNode = useMoveAppAssetNode()
  const emitTreeUpdate = useSkillTreeUpdateEmitter()
  const isPastingRef = useRef(false)

  const handlePaste = useCallback(async () => {
    if (isPastingRef.current)
      return

    const clipboard = storeApi.getState().clipboard
    if (!clipboard || clipboard.nodeIds.size === 0)
      return

    const { operation, nodeIds } = clipboard
    const tree = treeRef.current
    const treeChildren = treeData?.children ?? []

    const selectedId = tree?.selectedNodes[0]?.id ?? storeApi.getState().selectedTreeNodeId
    const targetFolderId = getTargetFolderIdFromSelection(selectedId, treeChildren)
    const targetParentId = toApiParentId(targetFolderId)

    if (operation === 'cut') {
      const nodeIdsArray = [...nodeIds]
      const isMovingToSelf = nodeIdsArray.some((nodeId) => {
        const node = findNodeById(treeChildren, nodeId)
        if (!node)
          return false
        if (node.node_type === 'folder' && nodeId === targetFolderId)
          return true
        return false
      })

      if (isMovingToSelf) {
        Toast.notify({
          type: 'error',
          message: t('skillSidebar.menu.cannotMoveToSelf'),
        })
        return
      }

      isPastingRef.current = true

      try {
        await Promise.all(
          nodeIdsArray.map(nodeId =>
            moveNode.mutateAsync({
              appId,
              nodeId,
              payload: { parent_id: targetParentId },
            }),
          ),
        )

        storeApi.getState().clearClipboard()
        emitTreeUpdate()

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
      finally {
        isPastingRef.current = false
      }
    }
  }, [appId, moveNode, storeApi, t, treeData?.children, treeRef, emitTreeUpdate])

  useEffect(() => {
    if (!enabled)
      return

    const handlePasteEvent = () => {
      handlePaste()
    }

    window.addEventListener('skill:paste', handlePasteEvent)
    return () => {
      window.removeEventListener('skill:paste', handlePasteEvent)
    }
  }, [enabled, handlePaste])

  return {
    isPasting: moveNode.isPending,
    handlePaste,
  }
}
