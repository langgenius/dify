import type {
  HotkeyCallback,
  UseHotkeyDefinition,
  UseHotkeyOptions,
} from '@tanstack/react-hotkeys'
import type { WorkflowCanvasHotkeyMeta, WorkflowCanvasShortcutDefinition } from './definitions'
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
import {
  subscribeWorkflowCommand,
  WorkflowCommand,
} from './commands'
import { WORKFLOW_CANVAS_SHORTCUTS } from './definitions'

const workflowHotkeyOptions = {
  ignoreInputs: true,
  conflictBehavior: 'warn',
} satisfies UseHotkeyOptions

const isInputLikeElement = (element: Element | null) => {
  if (!element)
    return false

  return element instanceof HTMLInputElement
    || element instanceof HTMLTextAreaElement
    || element instanceof HTMLSelectElement
    || (element instanceof HTMLElement && element.isContentEditable)
}

const toHotkeyDefinitions = (
  shortcut: WorkflowCanvasShortcutDefinition,
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
        scope: 'workflow-canvas',
        name: shortcut.name,
        description: shortcut.description,
      } satisfies WorkflowCanvasHotkeyMeta,
    },
  }))
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
    ...toHotkeyDefinitions(WORKFLOW_CANVAS_SHORTCUTS['workflow.delete'], () => {
      handleNodesDelete()
      handleEdgeDelete()
    }),
    ...toHotkeyDefinitions(WORKFLOW_CANVAS_SHORTCUTS['workflow.copy'], handleCopy, {
      preventDefault: false,
      stopPropagation: false,
      enabled: !showDebugAndPreviewPanel,
    }),
    ...toHotkeyDefinitions(WORKFLOW_CANVAS_SHORTCUTS['workflow.paste'], () => {
      handleNodesPaste()
    }, {
      enabled: !showDebugAndPreviewPanel,
    }),
    ...toHotkeyDefinitions(WORKFLOW_CANVAS_SHORTCUTS['workflow.duplicate'], () => {
      handleNodesDuplicate()
    }),
    ...toHotkeyDefinitions(WORKFLOW_CANVAS_SHORTCUTS['workflow.undo'], () => {
      handleHistoryBack()
    }, {
      enabled: !showDebugAndPreviewPanel && historyShortcutsEnabled,
    }),
    ...toHotkeyDefinitions(WORKFLOW_CANVAS_SHORTCUTS['workflow.redo'], () => {
      handleHistoryForward()
    }, {
      enabled: !showDebugAndPreviewPanel && historyShortcutsEnabled,
    }),
    ...toHotkeyDefinitions(WORKFLOW_CANVAS_SHORTCUTS['workflow.hand-mode'], () => {
      handleModeHand()
    }),
    ...toHotkeyDefinitions(WORKFLOW_CANVAS_SHORTCUTS['workflow.pointer-mode'], () => {
      handleModePointer()
    }),
    ...toHotkeyDefinitions(WORKFLOW_CANVAS_SHORTCUTS['workflow.comment-mode'], () => {
      handleModeComment()
    }, {
      enabled: isCommentModeAvailable,
    }),
    ...toHotkeyDefinitions(WORKFLOW_CANVAS_SHORTCUTS['workflow.organize'], () => {
      handleLayout()
    }),
    ...toHotkeyDefinitions(WORKFLOW_CANVAS_SHORTCUTS['workflow.toggle-maximize'], () => {
      handleToggleMaximizeCanvas()
    }),
    ...toHotkeyDefinitions(WORKFLOW_CANVAS_SHORTCUTS['workflow.zoom-to-fit'], () => {
      fitView()
      handleSyncWorkflowDraft()
    }),
    ...toHotkeyDefinitions(WORKFLOW_CANVAS_SHORTCUTS['workflow.zoom-to-100'], () => {
      zoomTo(1)
      handleSyncWorkflowDraft()
    }),
    ...toHotkeyDefinitions(WORKFLOW_CANVAS_SHORTCUTS['workflow.zoom-to-50'], () => {
      zoomTo(0.5)
      handleSyncWorkflowDraft()
    }),
    ...toHotkeyDefinitions(WORKFLOW_CANVAS_SHORTCUTS['workflow.zoom-out'], () => {
      constrainedZoomOut()
      handleSyncWorkflowDraft()
    }),
    ...toHotkeyDefinitions(WORKFLOW_CANVAS_SHORTCUTS['workflow.zoom-in'], () => {
      constrainedZoomIn()
      handleSyncWorkflowDraft()
    }),
    ...toHotkeyDefinitions(WORKFLOW_CANVAS_SHORTCUTS['workflow.download-import-log'], () => {
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

      if (isInputLikeElement(document.activeElement))
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
