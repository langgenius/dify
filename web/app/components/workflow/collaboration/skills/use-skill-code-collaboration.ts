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
  onRemoteChange?: (value: string) => void
  onLeaderSync: () => void
}

export const useSkillCodeCollaboration = ({
  appId,
  fileId,
  enabled,
  initialContent,
  baselineContent,
  onLocalChange,
  onRemoteChange,
  onLeaderSync,
}: UseSkillCodeCollaborationProps) => {
  const storeApi = useWorkflowStore()
  const suppressNextChangeRef = useRef<string | null>(null)
  const baselineContentRef = useRef(baselineContent)
  const onRemoteChangeRef = useRef(onRemoteChange)
  const onLeaderSyncRef = useRef(onLeaderSync)

  useEffect(() => {
    suppressNextChangeRef.current = null
  }, [fileId])

  useEffect(() => {
    baselineContentRef.current = baselineContent
  }, [baselineContent])

  useEffect(() => {
    onRemoteChangeRef.current = onRemoteChange
  }, [onRemoteChange])

  useEffect(() => {
    onLeaderSyncRef.current = onLeaderSync
  }, [onLeaderSync])

  useEffect(() => {
    if (!enabled || !fileId)
      return

    try {
      skillCollaborationManager.openFile(appId, fileId, initialContent)
    }
    catch (error) {
      console.error('Failed to initialize skill collaboration:', error)
      return
    }

    skillCollaborationManager.setActiveFile(appId, fileId, true)

    const unsubscribe = skillCollaborationManager.subscribe(fileId, (nextText) => {
      suppressNextChangeRef.current = nextText
      if (onRemoteChangeRef.current) {
        onRemoteChangeRef.current(nextText)
      }
      else {
        const state = storeApi.getState()
        if (nextText === baselineContentRef.current) {
          state.clearDraftContent(fileId)
        }
        else {
          state.setDraftContent(fileId, nextText)
          state.pinTab(fileId)
        }
      }
    })

    const unsubscribeSync = skillCollaborationManager.onSyncRequest(fileId, () => {
      onLeaderSyncRef.current()
    })

    return () => {
      unsubscribe()
      unsubscribeSync()
      skillCollaborationManager.setActiveFile(appId, fileId, false)
      skillCollaborationManager.closeFile(fileId)
    }
  }, [appId, enabled, fileId, initialContent, storeApi])

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
