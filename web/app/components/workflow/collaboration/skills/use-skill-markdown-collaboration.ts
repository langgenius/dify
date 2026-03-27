import { useCallback, useEffect, useRef } from 'react'
import { PROMPT_EDITOR_UPDATE_VALUE_BY_EVENT_EMITTER } from '@/app/components/base/prompt-editor/plugins/update-block'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { skillCollaborationManager } from './skill-collaboration-manager'

type UseSkillMarkdownCollaborationProps = {
  appId: string
  fileId: string | null
  enabled: boolean
  initialContent: string
  baselineContent: string
  onLocalChange: (value: string) => void
  onRemoteChange?: (value: string) => void
  onLeaderSync: () => void
}

export const useSkillMarkdownCollaboration = ({
  appId,
  fileId,
  enabled,
  initialContent,
  baselineContent,
  onLocalChange,
  onRemoteChange,
  onLeaderSync,
}: UseSkillMarkdownCollaborationProps) => {
  const storeApi = useWorkflowStore()
  const { eventEmitter } = useEventEmitterContextContext()
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
      eventEmitter?.emit({
        type: PROMPT_EDITOR_UPDATE_VALUE_BY_EVENT_EMITTER,
        instanceId: fileId,
        payload: nextText,
      } as unknown as string)
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
  }, [appId, enabled, eventEmitter, fileId, initialContent, storeApi])

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
