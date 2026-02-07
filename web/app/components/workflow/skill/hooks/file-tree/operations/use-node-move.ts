'use client'

// Internal tree node move handler - API execution logic only
// Drag state syncing is handled by react-arborist + TreeNode useEffect

import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import Toast from '@/app/components/base/toast'
import { useMoveAppAssetNode } from '@/service/use-app-asset'
import { toApiParentId } from '../../../utils/tree-utils'
import { useSkillTreeUpdateEmitter } from '../data/use-skill-tree-collaboration'

export function useNodeMove() {
  const { t } = useTranslation('workflow')
  const appDetail = useAppStore(s => s.appDetail)
  const appId = appDetail?.id || ''
  const moveNode = useMoveAppAssetNode()
  const emitTreeUpdate = useSkillTreeUpdateEmitter()

  // Execute move API call - validation is handled by react-arborist's disableDrop callback
  const executeMoveNode = useCallback(async (nodeId: string, targetFolderId: string | null) => {
    try {
      await moveNode.mutateAsync({
        appId,
        nodeId,
        payload: { parent_id: toApiParentId(targetFolderId) },
      })

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
  }, [appId, moveNode, t, emitTreeUpdate])

  return {
    executeMoveNode,
    isMoving: moveNode.isPending,
  }
}
