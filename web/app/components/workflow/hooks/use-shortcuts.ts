import { useKeyPress } from 'ahooks'
import { useCallback, useEffect } from 'react'
import { useReactFlow } from 'reactflow'
import { ZEN_TOGGLE_EVENT } from '@/app/components/goto-anything/actions/commands/zen'
import {
  useEdgesInteractions,
  useNodesInteractions,
  useNodesSyncDraft,
  useWorkflowCanvasMaximize,
  useWorkflowMoveMode,
  useWorkflowOrganize,
} from '.'
import { useWorkflowStore } from '../store'
import {
  getKeyboardKeyCodeBySystem,
  isEventTargetInputArea,
} from '../utils'
import { useWorkflowHistoryStore } from '../workflow-history-store'

export const useShortcuts = (): void => {
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
  const { shortcutsEnabled: workflowHistoryShortcutsEnabled } = useWorkflowHistoryStore()
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()
  const { handleEdgeDelete } = useEdgesInteractions()
  const workflowStore = useWorkflowStore()
  const {
    handleModeHand,
    handleModePointer,
  } = useWorkflowMoveMode()
  const { handleLayout } = useWorkflowOrganize()
  const { handleToggleMaximizeCanvas } = useWorkflowCanvasMaximize()

  const {
    zoomTo,
    getZoom,
    fitView,
  } = useReactFlow()

  // Zoom out to a minimum of 0.25 for shortcut
  const constrainedZoomOut = () => {
    const currentZoom = getZoom()
    const newZoom = Math.max(currentZoom - 0.1, 0.25)
    zoomTo(newZoom)
  }

  // Zoom in to a maximum of 2 for shortcut
  const constrainedZoomIn = () => {
    const currentZoom = getZoom()
    const newZoom = Math.min(currentZoom + 0.1, 2)
    zoomTo(newZoom)
  }

  const shouldHandleShortcut = useCallback((e: KeyboardEvent) => {
    return !isEventTargetInputArea(e.target as HTMLElement)
  }, [])

  const shouldHandleCopy = useCallback(() => {
    const selection = document.getSelection()
    return !selection || selection.isCollapsed
  }, [])

  useKeyPress(['delete', 'backspace'], (e) => {
    if (shouldHandleShortcut(e)) {
      e.preventDefault()
      handleNodesDelete()
      handleEdgeDelete()
    }
  })

  useKeyPress(`${getKeyboardKeyCodeBySystem('ctrl')}.c`, (e) => {
    const { showDebugAndPreviewPanel } = workflowStore.getState()
    if (shouldHandleShortcut(e) && shouldHandleCopy() && !showDebugAndPreviewPanel) {
      e.preventDefault()
      handleNodesCopy()
    }
  }, { exactMatch: true, useCapture: true })

  useKeyPress(`${getKeyboardKeyCodeBySystem('ctrl')}.v`, (e) => {
    const { showDebugAndPreviewPanel } = workflowStore.getState()
    if (shouldHandleShortcut(e) && !showDebugAndPreviewPanel) {
      e.preventDefault()
      handleNodesPaste()
    }
  }, { exactMatch: true, useCapture: true })

  useKeyPress(`${getKeyboardKeyCodeBySystem('ctrl')}.d`, (e) => {
    if (shouldHandleShortcut(e)) {
      e.preventDefault()
      handleNodesDuplicate()
    }
  }, { exactMatch: true, useCapture: true })

  useKeyPress(`${getKeyboardKeyCodeBySystem('alt')}.r`, (e) => {
    if (shouldHandleShortcut(e)) {
      e.preventDefault()
      // @ts-expect-error - Dynamic property added by run-and-history component
      if (window._toggleTestRunDropdown) {
        // @ts-expect-error - Dynamic property added by run-and-history component
        window._toggleTestRunDropdown()
      }
    }
  }, { exactMatch: true, useCapture: true })

  useKeyPress(`${getKeyboardKeyCodeBySystem('ctrl')}.z`, (e) => {
    const { showDebugAndPreviewPanel } = workflowStore.getState()
    if (shouldHandleShortcut(e) && !showDebugAndPreviewPanel) {
      e.preventDefault()
      if (workflowHistoryShortcutsEnabled)
        handleHistoryBack()
    }
  }, { exactMatch: true, useCapture: true })

  useKeyPress(
    [`${getKeyboardKeyCodeBySystem('ctrl')}.y`, `${getKeyboardKeyCodeBySystem('ctrl')}.shift.z`],
    (e) => {
      if (shouldHandleShortcut(e)) {
        e.preventDefault()
        if (workflowHistoryShortcutsEnabled)
          handleHistoryForward()
      }
    },
    { exactMatch: true, useCapture: true },
  )

  useKeyPress('h', (e) => {
    if (shouldHandleShortcut(e)) {
      e.preventDefault()
      handleModeHand()
    }
  }, {
    exactMatch: true,
    useCapture: true,
  })

  useKeyPress('v', (e) => {
    if (shouldHandleShortcut(e)) {
      e.preventDefault()
      handleModePointer()
    }
  }, {
    exactMatch: true,
    useCapture: true,
  })

  useKeyPress(`${getKeyboardKeyCodeBySystem('ctrl')}.o`, (e) => {
    if (shouldHandleShortcut(e)) {
      e.preventDefault()
      handleLayout()
    }
  }, { exactMatch: true, useCapture: true })

  useKeyPress('f', (e) => {
    if (shouldHandleShortcut(e)) {
      e.preventDefault()
      handleToggleMaximizeCanvas()
    }
  }, {
    exactMatch: true,
    useCapture: true,
  })

  useKeyPress(`${getKeyboardKeyCodeBySystem('ctrl')}.1`, (e) => {
    if (shouldHandleShortcut(e)) {
      e.preventDefault()
      fitView()
      handleSyncWorkflowDraft()
    }
  }, {
    exactMatch: true,
    useCapture: true,
  })

  useKeyPress('shift.1', (e) => {
    if (shouldHandleShortcut(e)) {
      e.preventDefault()
      zoomTo(1)
      handleSyncWorkflowDraft()
    }
  }, {
    exactMatch: true,
    useCapture: true,
  })

  useKeyPress('shift.5', (e) => {
    if (shouldHandleShortcut(e)) {
      e.preventDefault()
      zoomTo(0.5)
      handleSyncWorkflowDraft()
    }
  }, {
    exactMatch: true,
    useCapture: true,
  })

  useKeyPress(`${getKeyboardKeyCodeBySystem('ctrl')}.dash`, (e) => {
    if (shouldHandleShortcut(e)) {
      e.preventDefault()
      constrainedZoomOut()
      handleSyncWorkflowDraft()
    }
  }, {
    exactMatch: true,
    useCapture: true,
  })

  useKeyPress(`${getKeyboardKeyCodeBySystem('ctrl')}.equalsign`, (e) => {
    if (shouldHandleShortcut(e)) {
      e.preventDefault()
      constrainedZoomIn()
      handleSyncWorkflowDraft()
    }
  }, {
    exactMatch: true,
    useCapture: true,
  })

  // Shift ↓
  useKeyPress(
    'shift',
    (e) => {
      if (shouldHandleShortcut(e))
        dimOtherNodes()
    },
    {
      exactMatch: true,
      useCapture: true,
      events: ['keydown'],
    },
  )

  // Shift ↑
  useKeyPress(
    (e) => {
      return e.key === 'Shift'
    },
    (e) => {
      if (shouldHandleShortcut(e))
        undimAllNodes()
    },
    {
      exactMatch: true,
      useCapture: true,
      events: ['keyup'],
    },
  )

  // Listen for zen toggle event from /zen command
  useEffect(() => {
    const handleZenToggle = () => {
      handleToggleMaximizeCanvas()
    }

    window.addEventListener(ZEN_TOGGLE_EVENT, handleZenToggle)
    return () => {
      window.removeEventListener(ZEN_TOGGLE_EVENT, handleZenToggle)
    }
  }, [handleToggleMaximizeCanvas])
}
