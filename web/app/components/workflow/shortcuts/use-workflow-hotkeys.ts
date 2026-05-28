import type {
  HotkeyCallback,
  UseHotkeyDefinition,
  UseHotkeyOptions,
} from '@tanstack/react-hotkeys'
import type { WorkflowHotkeyMeta, WorkflowShortcutDefinition, WorkflowShortcutId } from './definitions'
import { useHotkeys, useKeyHold } from '@tanstack/react-hotkeys'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useReactFlow } from 'reactflow'
import { collaborationManager } from '../collaboration/core/collaboration-manager'
import { useEdgesInteractions } from '../hooks/use-edges-interactions'
import { useNodesInteractions } from '../hooks/use-nodes-interactions'
import { useNodesSyncDraft } from '../hooks/use-nodes-sync-draft'
import { useWorkflowCanvasMaximize } from '../hooks/use-workflow-canvas-maximize'
import { useWorkflowOrganize } from '../hooks/use-workflow-organize'
import { useWorkflowMoveMode } from '../hooks/use-workflow-panel-interactions'
import { useStore } from '../store/workflow'
import { isEventTargetInputArea } from '../utils'
import {
  subscribeWorkflowCommand,
  WorkflowCommand,
} from './commands'
import { WORKFLOW_SHORTCUTS } from './definitions'

const workflowHotkeyOptions = {
  ignoreInputs: true,
  conflictBehavior: 'warn',
} satisfies UseHotkeyOptions

const toHotkeyDefinitions = (
  shortcut: WorkflowShortcutDefinition,
  callback: HotkeyCallback,
  options?: UseHotkeyOptions,
): UseHotkeyDefinition[] => {
  return shortcut.hotkeys.map(hotkey => ({
    hotkey,
    callback,
    options: {
      ...options,
      meta: {
        id: shortcut.id,
        scope: 'workflow',
        name: shortcut.name,
        description: shortcut.description,
      } satisfies WorkflowHotkeyMeta,
    },
  }))
}

export const useWorkflowShortcut = (
  id: WorkflowShortcutId,
  callback: HotkeyCallback,
  options?: UseHotkeyOptions,
) => {
  const shortcut = WORKFLOW_SHORTCUTS[id]
  const hotkeys = useMemo(
    () => toHotkeyDefinitions(shortcut, callback, options),
    [callback, options, shortcut],
  )

  useHotkeys(hotkeys, workflowHotkeyOptions)
}

export const useWorkflowHotkeys = (): void => {
  const {
    handleNodesCopy,
    handleNodesPaste,
    handleNodesDuplicate,
    handleNodesDelete,
    handleHistoryBack,
    handleHistoryForward,
    dimOtherNodes,
    undimAllNodes,
  } = useNodesInteractions()
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()
  const { handleEdgeDelete } = useEdgesInteractions()
  const showDebugAndPreviewPanel = useStore(s => s.showDebugAndPreviewPanel)
  const historyShortcutsEnabled = useStore(s => s.historyShortcutsEnabled)
  const {
    handleModeHand,
    handleModePointer,
    handleModeComment,
    isCommentModeAvailable,
  } = useWorkflowMoveMode()
  const { handleLayout } = useWorkflowOrganize()
  const { handleToggleMaximizeCanvas } = useWorkflowCanvasMaximize()

  const {
    zoomTo,
    getZoom,
    fitView,
    getNodes,
  } = useReactFlow()
  const isShiftHeld = useKeyHold('Shift')
  const shiftDimmedRef = useRef(false)
  const undimAllNodesRef = useRef(undimAllNodes)
  undimAllNodesRef.current = undimAllNodes

  const constrainedZoomOut = useCallback(() => {
    const currentZoom = getZoom()
    const newZoom = Math.max(currentZoom - 0.1, 0.25)
    zoomTo(newZoom)
  }, [getZoom, zoomTo])

  const constrainedZoomIn = useCallback(() => {
    const currentZoom = getZoom()
    const newZoom = Math.min(currentZoom + 0.1, 2)
    zoomTo(newZoom)
  }, [getZoom, zoomTo])

  const shouldHandleCopy = useCallback(() => {
    if (getNodes().some(node => node.data._isBundled))
      return true

    const selection = document.getSelection()
    return !selection || selection.isCollapsed || !selection.rangeCount
  }, [getNodes])

  const handleCopy = useCallback<HotkeyCallback>((event) => {
    if (!shouldHandleCopy())
      return

    event.preventDefault()
    event.stopPropagation()
    handleNodesCopy()
  }, [handleNodesCopy, shouldHandleCopy])

  const handleZenToggle = useCallback(() => {
    handleToggleMaximizeCanvas()
  }, [handleToggleMaximizeCanvas])

  const hotkeys = useMemo<UseHotkeyDefinition[]>(() => [
    ...toHotkeyDefinitions(WORKFLOW_SHORTCUTS['workflow.delete'], () => {
      handleNodesDelete()
      handleEdgeDelete()
    }),
    ...toHotkeyDefinitions(WORKFLOW_SHORTCUTS['workflow.copy'], handleCopy, {
      preventDefault: false,
      stopPropagation: false,
      enabled: !showDebugAndPreviewPanel,
    }),
    ...toHotkeyDefinitions(WORKFLOW_SHORTCUTS['workflow.paste'], () => {
      handleNodesPaste()
    }, {
      enabled: !showDebugAndPreviewPanel,
    }),
    ...toHotkeyDefinitions(WORKFLOW_SHORTCUTS['workflow.duplicate'], () => {
      handleNodesDuplicate()
    }),
    ...toHotkeyDefinitions(WORKFLOW_SHORTCUTS['workflow.undo'], () => {
      handleHistoryBack()
    }, {
      enabled: !showDebugAndPreviewPanel && historyShortcutsEnabled,
    }),
    ...toHotkeyDefinitions(WORKFLOW_SHORTCUTS['workflow.redo'], () => {
      handleHistoryForward()
    }, {
      enabled: !showDebugAndPreviewPanel && historyShortcutsEnabled,
    }),
    ...toHotkeyDefinitions(WORKFLOW_SHORTCUTS['workflow.hand-mode'], () => {
      handleModeHand()
    }),
    ...toHotkeyDefinitions(WORKFLOW_SHORTCUTS['workflow.pointer-mode'], () => {
      handleModePointer()
    }),
    ...toHotkeyDefinitions(WORKFLOW_SHORTCUTS['workflow.comment-mode'], () => {
      handleModeComment()
    }, {
      enabled: isCommentModeAvailable,
    }),
    ...toHotkeyDefinitions(WORKFLOW_SHORTCUTS['workflow.organize'], () => {
      handleLayout()
    }),
    ...toHotkeyDefinitions(WORKFLOW_SHORTCUTS['workflow.toggle-maximize'], () => {
      handleToggleMaximizeCanvas()
    }),
    ...toHotkeyDefinitions(WORKFLOW_SHORTCUTS['workflow.zoom-to-fit'], () => {
      fitView()
      handleSyncWorkflowDraft()
    }),
    ...toHotkeyDefinitions(WORKFLOW_SHORTCUTS['workflow.zoom-to-100'], () => {
      zoomTo(1)
      handleSyncWorkflowDraft()
    }),
    ...toHotkeyDefinitions(WORKFLOW_SHORTCUTS['workflow.zoom-to-50'], () => {
      zoomTo(0.5)
      handleSyncWorkflowDraft()
    }),
    ...toHotkeyDefinitions(WORKFLOW_SHORTCUTS['workflow.zoom-out'], () => {
      constrainedZoomOut()
      handleSyncWorkflowDraft()
    }),
    ...toHotkeyDefinitions(WORKFLOW_SHORTCUTS['workflow.zoom-in'], () => {
      constrainedZoomIn()
      handleSyncWorkflowDraft()
    }),
    ...toHotkeyDefinitions(WORKFLOW_SHORTCUTS['workflow.download-import-log'], () => {
      collaborationManager.downloadGraphImportLog()
    }),
  ], [
    constrainedZoomIn,
    constrainedZoomOut,
    fitView,
    handleCopy,
    handleEdgeDelete,
    handleHistoryBack,
    handleHistoryForward,
    handleLayout,
    handleModeComment,
    handleModeHand,
    handleModePointer,
    handleNodesDelete,
    handleNodesDuplicate,
    handleNodesPaste,
    handleSyncWorkflowDraft,
    handleToggleMaximizeCanvas,
    historyShortcutsEnabled,
    isCommentModeAvailable,
    showDebugAndPreviewPanel,
    zoomTo,
  ])

  useHotkeys(hotkeys, workflowHotkeyOptions)

  useEffect(() => {
    if (isShiftHeld) {
      if (shiftDimmedRef.current)
        return

      if (isEventTargetInputArea(document.activeElement as HTMLElement))
        return

      shiftDimmedRef.current = true
      dimOtherNodes()
      return
    }

    if (!shiftDimmedRef.current)
      return

    shiftDimmedRef.current = false
    undimAllNodes()
  }, [dimOtherNodes, isShiftHeld, undimAllNodes])

  useEffect(() => {
    return () => {
      if (shiftDimmedRef.current)
        undimAllNodesRef.current()
    }
  }, [])

  useEffect(() => {
    return subscribeWorkflowCommand(WorkflowCommand.ToggleCanvasMaximize, handleZenToggle)
  }, [handleZenToggle])
}
