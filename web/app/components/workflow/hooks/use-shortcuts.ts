// import { useCallback, useEffect, useMemo } from 'react'
// import { useWorkflowStore } from '../store'
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
  const { showFeaturesPanel } = workflowStore.getState()
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

  useKeyPress(['delete', 'backspace'], (e) => {
    if (isEventTargetInputArea(e.target as HTMLElement) || showFeaturesPanel)
      return

    handleNodesDelete()
  })

  useKeyPress(['delete', 'backspace'], (e) => {
    if (isEventTargetInputArea(e.target as HTMLElement || showFeaturesPanel))
      return

    handleEdgeDelete()
  })

  useKeyPress(`${getKeyboardKeyCodeBySystem('ctrl')}.c`, (e) => {
    if (isEventTargetInputArea(e.target as HTMLElement || showFeaturesPanel))
      return

    handleNodesCopy()
  }, { exactMatch: true, useCapture: true })

  useKeyPress(`${getKeyboardKeyCodeBySystem('ctrl')}.v`, (e) => {
    if (isEventTargetInputArea(e.target as HTMLElement || showFeaturesPanel))
      return

    handleNodesPaste()
  }, { exactMatch: true, useCapture: true })

  useKeyPress(`${getKeyboardKeyCodeBySystem('ctrl')}.d`, (e) => {
    if (isEventTargetInputArea(e.target as HTMLElement || showFeaturesPanel))
      return

    handleNodesDuplicate()
  }, { exactMatch: true, useCapture: true })
  useKeyPress(`${getKeyboardKeyCodeBySystem('alt')}.r`, (e) => {
    if (isEventTargetInputArea(e.target as HTMLElement || showFeaturesPanel))
      return

    handleStartWorkflowRun()
  }, { exactMatch: true, useCapture: true })

  useKeyPress(`${getKeyboardKeyCodeBySystem('alt')}.r`, (e) => {
    if (isEventTargetInputArea(e.target as HTMLElement || showFeaturesPanel))
      return

    handleStartWorkflowRun()
  }, { exactMatch: true, useCapture: true })

  useKeyPress(
    `${getKeyboardKeyCodeBySystem('ctrl')}.z`, (e) => {
      if (isEventTargetInputArea(e.target as HTMLElement || showFeaturesPanel))
        return

      workflowHistoryShortcutsEnabled && handleHistoryBack()
    },
    { exactMatch: true, useCapture: true },
  )

  useKeyPress(
    [`${getKeyboardKeyCodeBySystem('ctrl')}.y`, `${getKeyboardKeyCodeBySystem('ctrl')}.shift.z`],
    (e) => {
      if (isEventTargetInputArea(e.target as HTMLElement || showFeaturesPanel))
        return

      workflowHistoryShortcutsEnabled && handleHistoryForward()
    },
    { exactMatch: true, useCapture: true },
  )
  useKeyPress('h', (e) => {
    if (getNodesReadOnly())
      return

    if (isEventTargetInputArea(e.target as HTMLElement || showFeaturesPanel))
      return

    e.preventDefault()
    handleModeHand()
  }, {
    exactMatch: true,
    useCapture: true,
  })

  useKeyPress('v', (e) => {
    if (isEventTargetInputArea(e.target as HTMLElement || showFeaturesPanel))
      return

    e.preventDefault()
    handleModePointer()
  }, {
    exactMatch: true,
    useCapture: true,
  })

  useKeyPress(`${getKeyboardKeyCodeBySystem('ctrl')}.o`, (e) => {
    if (isEventTargetInputArea(e.target as HTMLElement || showFeaturesPanel))
      return

    e.preventDefault()
    handleGoLayout()
  }, { exactMatch: true, useCapture: true })

  useKeyPress(`${getKeyboardKeyCodeBySystem('ctrl')}.1`, (e) => {
    if (isEventTargetInputArea(e.target as HTMLElement || showFeaturesPanel))
      return

    e.preventDefault()
    if (workflowReadOnly)
      return

    fitView()
    handleSyncWorkflowDraft()
  }, {
    exactMatch: true,
    useCapture: true,
  })

  useKeyPress('shift.1', (e) => {
    if (workflowReadOnly)
      return

    if (isEventTargetInputArea(e.target as HTMLElement) || showFeaturesPanel)
      return

    e.preventDefault()
    zoomTo(1)
    handleSyncWorkflowDraft()
  }, {
    exactMatch: true,
    useCapture: true,
  })

  useKeyPress('shift.5', (e) => {
    if (workflowReadOnly)
      return

    if (isEventTargetInputArea(e.target as HTMLElement) || showFeaturesPanel)
      return

    e.preventDefault()
    zoomTo(0.5)
    handleSyncWorkflowDraft()
  }, {
    exactMatch: true,
    useCapture: true,
  })

  useKeyPress(`${getKeyboardKeyCodeBySystem('ctrl')}.dash`, (e) => {
    e.preventDefault()
    if (workflowReadOnly)
      return

    if (isEventTargetInputArea(e.target as HTMLElement) || showFeaturesPanel)
      return

    zoomOut()
    handleSyncWorkflowDraft()
  }, {
    exactMatch: true,
    useCapture: true,
  })

  useKeyPress(`${getKeyboardKeyCodeBySystem('ctrl')}.equalsign`, (e) => {
    e.preventDefault()
    if (workflowReadOnly)
      return

    if (isEventTargetInputArea(e.target as HTMLElement) || showFeaturesPanel)
      return

    zoomIn()
    handleSyncWorkflowDraft()
  }, {
    exactMatch: true,
    useCapture: true,
  })
}
