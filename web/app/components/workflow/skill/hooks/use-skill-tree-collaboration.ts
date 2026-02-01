'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect } from 'react'
import { useStore as useAppStore } from '@/app/components/app/store'
import { skillCollaborationManager } from '@/app/components/workflow/collaboration/skills/skill-collaboration-manager'
import { useSystemFeatures } from '@/hooks/use-global-public'
import { consoleQuery } from '@/service/client'

export const useSkillTreeUpdateEmitter = () => {
  const appDetail = useAppStore(s => s.appDetail)
  const appId = appDetail?.id || ''
  const isCollaborationEnabled = useSystemFeatures().enable_collaboration_mode

  return useCallback((payload: Record<string, unknown> = {}) => {
    if (!appId || !isCollaborationEnabled)
      return
    skillCollaborationManager.emitTreeUpdate(appId, payload)
  }, [appId, isCollaborationEnabled])
}

export const useSkillTreeCollaboration = () => {
  const appDetail = useAppStore(s => s.appDetail)
  const appId = appDetail?.id || ''
  const isCollaborationEnabled = useSystemFeatures().enable_collaboration_mode
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!appId || !isCollaborationEnabled)
      return

    return skillCollaborationManager.onTreeUpdate(appId, () => {
      queryClient.invalidateQueries({
        queryKey: consoleQuery.appAsset.tree.queryKey({ input: { params: { appId } } }),
      })
    })
  }, [appId, isCollaborationEnabled, queryClient])
}
