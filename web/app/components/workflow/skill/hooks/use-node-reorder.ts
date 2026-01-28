'use client'

// Internal tree node reorder handler - API execution logic only

import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import Toast from '@/app/components/base/toast'
import { useReorderAppAssetNode } from '@/service/use-app-asset'

export function useNodeReorder() {
  const { t } = useTranslation('workflow')
  const appDetail = useAppStore(s => s.appDetail)
  const appId = appDetail?.id || ''
  const reorderNode = useReorderAppAssetNode()

  const executeReorderNode = useCallback(async (nodeId: string, afterNodeId: string | null) => {
    try {
      await reorderNode.mutateAsync({
        appId,
        nodeId,
        payload: { after_node_id: afterNodeId },
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
  }, [appId, reorderNode, t])

  return {
    executeReorderNode,
    isReordering: reorderNode.isPending,
  }
}
