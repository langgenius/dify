'use client'

import { useCallback } from 'react'
// Internal tree node reorder handler - API execution logic only

import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import { toast } from '@/app/components/base/ui/toast'
import { useReorderAppAssetNode } from '@/service/use-app-asset'
import { useSkillTreeUpdateEmitter } from '../data/use-skill-tree-collaboration'

export function useNodeReorder() {
  const { t } = useTranslation('workflow')
  const appDetail = useAppStore(s => s.appDetail)
  const appId = appDetail?.id || ''
  const { mutateAsync: reorderNodeAsync, isPending: isReordering } = useReorderAppAssetNode()
  const emitTreeUpdate = useSkillTreeUpdateEmitter()

  const executeReorderNode = useCallback(async (nodeId: string, afterNodeId: string | null) => {
    try {
      await reorderNodeAsync({
        appId,
        nodeId,
        payload: { after_node_id: afterNodeId },
      })

      emitTreeUpdate()
      toast.success(t('skillSidebar.menu.moved'))
    }
    catch {
      toast.error(t('skillSidebar.menu.moveError'))
    }
  }, [appId, reorderNodeAsync, t, emitTreeUpdate])

  return {
    executeReorderNode,
    isReordering,
  }
}
