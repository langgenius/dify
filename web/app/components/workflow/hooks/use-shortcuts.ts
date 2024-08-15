import { useReactFlow } from 'reactflow'
import { useKeyPress } from 'ahooks'
import {
  getKeyboardKeyCodeBySystem,
  isEventTargetInputArea,
} from '../utils'
import { useWorkflowHistoryStore } from '../workflow-history-store'
import { useWorkflowStore } from '../store'
import {
  useEdgesInteractions,
  useNodesInteractions,
  useNodesReadOnly,
  useNodesSyncDraft,
  useWorkflowMoveMode,
  useWorkflowOrganize,
  useWorkflowReadOnly,
  useWorkflowStartRun,
} from '.'

export const useShortcuts = (): void => {
  const {
    handleNodesCopy,
    handleNodesPaste,
    handleNodesDuplicate,
    handleNodesDelete,
    handleHistoryBack,
    handleHistoryForward,
  } = useNodesInteractions()
  const { handleStartWorkflowRun } = useWorkflowStartRun()
  const { shortcutsEnabled: workflowHistoryShortcutsEnabled } = useWorkflowHistoryStore()
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()
  const { handleEdgeDelete } = useEdgesInteractions()
  const { handleGoLayout } = useWorkflowOrganize()
  const { getNodesReadOnly } = useNodesReadOnly()
  const { workflowReadOnly } = useWorkflowReadOnly()
  const workflowStore = useWorkflowStore()
  const {
    handleModeHand,
    handleModePointer,
  } = useWorkflowMoveMode()

  const {
    zoomIn,
    zoomOut,
    zoomTo,
    fitView,
  } = useReactFlow()

  const shouldHandleShortcut = (e: KeyboardEvent) => {
    const { showFeaturesPanel } = workflowStore.getState()
    return !(isEventTargetInputArea(e.target as HTMLElement) || showFeaturesPanel)
  }

  useKeyPress(['delete', 'backspace'], (e) => {
    e.preventDefault()
    if (!shouldHandleShortcut(e))
      return

    handleNodesDelete()
  })

  useKeyPress(['delete', 'backspace'], (e) => {
    e.preventDefault()
    if (!shouldHandleShortcut(e))
      return

    handleEdgeDelete()
  })

  useKeyPress(`${getKeyboardKeyCodeBySystem('ctrl')}.c`, (e) => {
    e.preventDefault()
    if (!shouldHandleShortcut(e))
      return

    handleNodesCopy()
  }, { exactMatch: true, useCapture: true })

  useKeyPress(`${getKeyboardKeyCodeBySystem('ctrl')}.v`, (e) => {
    e.preventDefault()
    if (!shouldHandleShortcut(e))
      return

    handleNodesPaste()
  }, { exactMatch: true, useCapture: true })

  useKeyPress(`${getKeyboardKeyCodeBySystem('ctrl')}.d`, (e) => {
    e.preventDefault()
    if (!shouldHandleShortcut(e))
      return

    handleNodesDuplicate()
  }, { exactMatch: true, useCapture: true })

  useKeyPress(`${getKeyboardKeyCodeBySystem('alt')}.r`, (e) => {
    e.preventDefault()
    if (!shouldHandleShortcut(e))
      return

    handleStartWorkflowRun()
  }, { exactMatch: true, useCapture: true })

  useKeyPress(`${getKeyboardKeyCodeBySystem('alt')}.r`, (e) => {
    e.preventDefault()
    if (!shouldHandleShortcut(e))
      return

    handleStartWorkflowRun()
  }, { exactMatch: true, useCapture: true })

  useKeyPress(
    `${getKeyboardKeyCodeBySystem('ctrl')}.z`, (e) => {
      e.preventDefault()
      if (!shouldHandleShortcut(e))
        return

      workflowHistoryShortcutsEnabled && handleHistoryBack()
    },
    { exactMatch: true, useCapture: true },
  )

  useKeyPress(
    [`${getKeyboardKeyCodeBySystem('ctrl')}.y`, `${getKeyboardKeyCodeBySystem('ctrl')}.shift.z`],
    (e) => {
      e.preventDefault()
      if (!shouldHandleShortcut(e))
        return

      workflowHistoryShortcutsEnabled && handleHistoryForward()
    },
    { exactMatch: true, useCapture: true },
  )
  useKeyPress('h', (e) => {
    e.preventDefault()
    if (!shouldHandleShortcut(e))
      return

    if (getNodesReadOnly())
      return

    handleModeHand()
  }, {
    exactMatch: true,
    useCapture: true,
  })

  useKeyPress('v', (e) => {
    e.preventDefault()
    if (!shouldHandleShortcut(e))
      return

    handleModePointer()
  }, {
    exactMatch: true,
    useCapture: true,
  })

  useKeyPress(`${getKeyboardKeyCodeBySystem('ctrl')}.o`, (e) => {
    e.preventDefault()
    if (!shouldHandleShortcut(e))
      return

    handleGoLayout()
  }, { exactMatch: true, useCapture: true })

  useKeyPress(`${getKeyboardKeyCodeBySystem('ctrl')}.1`, (e) => {
    e.preventDefault()
    if (!shouldHandleShortcut(e))
      return

    if (workflowReadOnly)
      return

    fitView()
    handleSyncWorkflowDraft()
  }, {
    exactMatch: true,
    useCapture: true,
  })

  useKeyPress('shift.1', (e) => {
    e.preventDefault()
    if (workflowReadOnly)
      return

    if (!shouldHandleShortcut(e))
      return

    e.preventDefault()
    zoomTo(1)
    handleSyncWorkflowDraft()
  }, {
    exactMatch: true,
    useCapture: true,
  })

  useKeyPress('shift.5', (e) => {
    e.preventDefault()
    if (!shouldHandleShortcut(e))
      return

    if (workflowReadOnly)
      return

    zoomTo(0.5)
    handleSyncWorkflowDraft()
  }, {
    exactMatch: true,
    useCapture: true,
  })

  useKeyPress(`${getKeyboardKeyCodeBySystem('ctrl')}.dash`, (e) => {
    e.preventDefault()
    if (!shouldHandleShortcut(e))
      return

    if (workflowReadOnly)
      return

    zoomOut()
    handleSyncWorkflowDraft()
  }, {
    exactMatch: true,
    useCapture: true,
  })

  useKeyPress(`${getKeyboardKeyCodeBySystem('ctrl')}.equalsign`, (e) => {
    e.preventDefault()
    if (!shouldHandleShortcut(e))
      return

    if (workflowReadOnly)
      return

    zoomIn()
    handleSyncWorkflowDraft()
  }, {
    exactMatch: true,
    useCapture: true,
  })
}
