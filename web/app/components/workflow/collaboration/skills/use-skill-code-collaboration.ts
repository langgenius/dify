import { useCallback, useEffect, useRef } from 'react'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { skillCollaborationManager } from './skill-collaboration-manager'

type UseSkillCodeCollaborationProps = {
  appId: string
  fileId: string | null
  enabled: boolean
  initialContent: string
  baselineContent: string
  onLocalChange: (value: string) => void
  onLeaderSync: () => void
}

export const useSkillCodeCollaboration = ({
  appId,
  fileId,
  enabled,
  initialContent,
  baselineContent,
  onLocalChange,
  onLeaderSync,
}: UseSkillCodeCollaborationProps) => {
  const storeApi = useWorkflowStore()
  const suppressNextChangeRef = useRef<string | null>(null)
  // Keep the latest server baseline to avoid marking the editor dirty on initial sync.
  const baselineContentRef = useRef(baselineContent)

  useEffect(() => {
    suppressNextChangeRef.current = null
  }, [fileId])

  useEffect(() => {
    baselineContentRef.current = baselineContent
  }, [baselineContent])

  useEffect(() => {
    if (!enabled || !fileId)
      return

    skillCollaborationManager.openFile(appId, fileId, initialContent)
    skillCollaborationManager.setActiveFile(appId, fileId, true)

    const unsubscribe = skillCollaborationManager.subscribe(fileId, (nextText) => {
      suppressNextChangeRef.current = nextText
      const state = storeApi.getState()
      if (nextText === baselineContentRef.current) {
        state.clearDraftContent(fileId)
      }
      else {
        state.setDraftContent(fileId, nextText)
        state.pinTab(fileId)
      }
    })

    const unsubscribeSync = skillCollaborationManager.onSyncRequest(fileId, onLeaderSync)

    return () => {
      unsubscribe()
      unsubscribeSync()
      skillCollaborationManager.setActiveFile(appId, fileId, false)
      skillCollaborationManager.closeFile(fileId)
    }
  }, [appId, enabled, fileId, initialContent, onLeaderSync, storeApi])

  const handleCollaborativeChange = useCallback((value: string | undefined) => {
    const nextValue = value ?? ''
    if (!fileId) {
      onLocalChange(nextValue)
      return
    }

    if (!enabled) {
      onLocalChange(nextValue)
      return
    }

    if (suppressNextChangeRef.current === nextValue) {
      suppressNextChangeRef.current = null
      return
    }

    skillCollaborationManager.updateText(fileId, nextValue)
    onLocalChange(nextValue)
  }, [enabled, fileId, onLocalChange])

  return {
    handleCollaborativeChange,
    isLeader: fileId ? skillCollaborationManager.isLeader(fileId) : false,
  }
}
