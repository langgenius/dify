import type { HotkeyCallback, UseHotkeyDefinition, UseHotkeyOptions } from '@tanstack/react-hotkeys'
import type { RefObject } from 'react'
import type {
  WorkflowCanvasHotkeyDefinition,
  WorkflowCanvasHotkeyId,
  WorkflowCanvasHotkeyMeta,
} from './definitions'
import { useHotkeys, useKeyHold } from '@tanstack/react-hotkeys'
import { useEffect, useEffectEvent, useRef } from 'react'
import { useReactFlow } from 'reactflow'
import { collaborationManager } from '../collaboration/core/collaboration-manager'
import { useEdgesInteractions } from '../hooks/use-edges-interactions'
import { useNodesInteractions } from '../hooks/use-nodes-interactions'
import { useNodesSyncDraft } from '../hooks/use-nodes-sync-draft'
import { useNodesReadOnly } from '../hooks/use-workflow'
import { useWorkflowOrganize } from '../hooks/use-workflow-organize'
import { useWorkflowMoveMode } from '../hooks/use-workflow-panel-interactions'
import { useStore } from '../store/workflow'
import { WORKFLOW_CANVAS_SHORTCUTS } from './definitions'

const workflowHotkeyOptions = {
  ignoreInputs: true,
  preventDefault: false,
  stopPropagation: false,
} satisfies UseHotkeyOptions

type WorkflowHotkeyOptions = {
  enabled?: boolean
  allowRepeat?: boolean
  shouldHandle?: () => boolean
}

const toHotkeyDefinitions = (
  id: WorkflowCanvasHotkeyId,
  shortcut: WorkflowCanvasHotkeyDefinition,
  callback: HotkeyCallback,
  target: RefObject<HTMLDivElement | null>,
  options?: WorkflowHotkeyOptions,
): UseHotkeyDefinition[] => {
  const { allowRepeat = false, shouldHandle, ...registrationOptions } = options ?? {}
  return shortcut.hotkeys.map((hotkey) => ({
    hotkey,
    callback: (event, context) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        !(event.target instanceof Node) ||
        !target.current?.contains(event.target) ||
        (shouldHandle && !shouldHandle())
      )
        return
      event.preventDefault()
      event.stopPropagation()
      if (event.repeat && !allowRepeat) return
      callback(event, context)
    },
    options: {
      ...registrationOptions,
      meta: {
        id,
        scope: 'workflow-canvas',
        name: shortcut.name,
        description: shortcut.description,
      } satisfies WorkflowCanvasHotkeyMeta,
    },
  }))
}

export const useWorkflowHotkeys = (
  target: RefObject<HTMLDivElement | null>,
  canvasHasFocus: boolean,
): void => {
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
  const showDebugAndPreviewPanel = useStore((s) => s.showDebugAndPreviewPanel)
  const { handleModeHand, handleModePointer, handleModeComment, canUseCommentMode } =
    useWorkflowMoveMode()
  const { handleLayout } = useWorkflowOrganize()
  const { nodesReadOnly } = useNodesReadOnly()

  const { zoomTo, getZoom, fitView, getNodes } = useReactFlow()
  const isShiftHeld = useKeyHold(WORKFLOW_CANVAS_SHORTCUTS['workflow.dim-other-nodes'].holdKey)
  const shiftDimmedRef = useRef(false)
  const undimAllNodesOnUnmount = useEffectEvent(undimAllNodes)

  function constrainedZoomOut() {
    const currentZoom = getZoom()
    const newZoom = Math.max(currentZoom - 0.1, 0.25)
    zoomTo(newZoom)
  }

  function constrainedZoomIn() {
    const currentZoom = getZoom()
    const newZoom = Math.min(currentZoom + 0.1, 2)
    zoomTo(newZoom)
  }

  function shouldHandleCopy() {
    if (getNodes().some((node) => node.data._isBundled)) return true

    const selection = document.getSelection()
    return !selection || selection.isCollapsed || !selection.rangeCount
  }

  const bind = (
    id: WorkflowCanvasHotkeyId,
    callback: HotkeyCallback,
    options?: WorkflowHotkeyOptions,
  ) => toHotkeyDefinitions(id, WORKFLOW_CANVAS_SHORTCUTS[id], callback, target, options)

  const hotkeys: UseHotkeyDefinition[] = [
    ...bind(
      'workflow.save-draft',
      () => {
        handleSyncWorkflowDraft()
      },
      { enabled: !nodesReadOnly },
    ),
    ...bind(
      'workflow.delete',
      () => {
        target.current?.focus({ preventScroll: true })
        handleNodesDelete()
        handleEdgeDelete()
      },
      { enabled: !nodesReadOnly },
    ),
    ...bind('workflow.copy', () => handleNodesCopy(), {
      shouldHandle: shouldHandleCopy,
      enabled: !nodesReadOnly && !showDebugAndPreviewPanel,
    }),
    ...bind(
      'workflow.paste',
      () => {
        handleNodesPaste()
      },
      {
        enabled: !nodesReadOnly && !showDebugAndPreviewPanel,
      },
    ),
    ...bind(
      'workflow.duplicate',
      () => {
        handleNodesDuplicate()
      },
      { enabled: !nodesReadOnly },
    ),
    ...bind(
      'workflow.undo',
      () => {
        target.current?.focus({ preventScroll: true })
        handleHistoryBack()
      },
      {
        enabled: !nodesReadOnly && !showDebugAndPreviewPanel,
      },
    ),
    ...bind(
      'workflow.redo',
      () => {
        target.current?.focus({ preventScroll: true })
        handleHistoryForward()
      },
      {
        enabled: !nodesReadOnly && !showDebugAndPreviewPanel,
      },
    ),
    ...bind(
      'workflow.hand-mode',
      () => {
        handleModeHand()
      },
      { enabled: !nodesReadOnly },
    ),
    ...bind(
      'workflow.pointer-mode',
      () => {
        handleModePointer()
      },
      { enabled: !nodesReadOnly },
    ),
    ...bind(
      'workflow.comment-mode',
      () => {
        handleModeComment()
      },
      {
        enabled: canUseCommentMode,
      },
    ),
    ...bind(
      'workflow.organize',
      () => {
        handleLayout()
      },
      { enabled: !nodesReadOnly },
    ),
    ...bind('workflow.zoom-to-fit', () => {
      fitView()
      handleSyncWorkflowDraft()
    }),
    ...bind('workflow.zoom-to-100', () => {
      zoomTo(1)
      handleSyncWorkflowDraft()
    }),
    ...bind('workflow.zoom-to-50', () => {
      zoomTo(0.5)
      handleSyncWorkflowDraft()
    }),
    ...bind(
      'workflow.zoom-out',
      () => {
        constrainedZoomOut()
        handleSyncWorkflowDraft()
      },
      { allowRepeat: true },
    ),
    ...bind(
      'workflow.zoom-in',
      () => {
        constrainedZoomIn()
        handleSyncWorkflowDraft()
      },
      { allowRepeat: true },
    ),
    ...bind('workflow.download-import-log', () => {
      collaborationManager.downloadGraphImportLog()
    }),
  ]

  // Listen after React's delegated child handlers, then claim only events from this canvas.
  useHotkeys(hotkeys, workflowHotkeyOptions)

  useEffect(() => {
    if (isShiftHeld && canvasHasFocus) {
      if (shiftDimmedRef.current) return

      shiftDimmedRef.current = true
      dimOtherNodes()
      return
    }

    if (!shiftDimmedRef.current) return

    shiftDimmedRef.current = false
    undimAllNodes()
  }, [canvasHasFocus, dimOtherNodes, isShiftHeld, undimAllNodes])

  useEffect(() => {
    return () => {
      if (shiftDimmedRef.current) undimAllNodesOnUnmount()
    }
  }, [])
}
