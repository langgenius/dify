import { useCallback, useEffect, useMemo } from 'react'
import { useWorkflowStore } from '../store'
import {
  getKeyboardKeyCodeBySystem,
  isEventTargetInputArea,
} from '../utils'
import { useWorkflowHistoryStore } from '../workflow-history-store'
import {
  useEdgesInteractions,
  useNodesInteractions,
  useWorkflowMoveMode,
  useWorkflowOrganize,
  useWorkflowStartRun,
  useWorkflowZoom,
} from '.'

type ShortcutHandler = (e: KeyboardEvent) => void

type ShortcutConfig = {
  keys: string | string[]
  handler: keyof ShortcutHandlers
  options?: { exactMatch?: boolean; useCapture?: boolean }
  condition?: keyof ShortcutConditions
}

type ShortcutHandlers = {
  handleNodesCopy: ShortcutHandler
  handleNodesPaste: ShortcutHandler
  handleNodesDuplicate: ShortcutHandler
  handleNodesDelete: ShortcutHandler
  handleEdgeDelete: ShortcutHandler
  handleStartWorkflowRun: ShortcutHandler
  handleHistoryBack: ShortcutHandler
  handleHistoryForward: ShortcutHandler
  handleModePointer: ShortcutHandler
  handleModeHand: ShortcutHandler
  handleGoLayout: ShortcutHandler
  handleFitView: ShortcutHandler
  handleBackToOriginalSize: ShortcutHandler
  handleSizeToHalf: ShortcutHandler
  handleZoomOut: ShortcutHandler
  handleZoomIn: ShortcutHandler
}

type ShortcutConditions = {
  workflowHistoryShortcutsEnabled: boolean
}

const createShortcutConfig = (): ShortcutConfig[] => {
  const ctrlKey = getKeyboardKeyCodeBySystem('ctrl')
  const altKey = getKeyboardKeyCodeBySystem('alt')
  const shiftKey = getKeyboardKeyCodeBySystem('shift')

  return [
    { keys: ['delete', 'backspace'], handler: 'handleNodesDelete' },
    { keys: ['delete', 'backspace'], handler: 'handleEdgeDelete' },
    { keys: `${ctrlKey}.c`, handler: 'handleNodesCopy', options: { exactMatch: true, useCapture: true } },
    { keys: `${ctrlKey}.v`, handler: 'handleNodesPaste', options: { exactMatch: true, useCapture: true } },
    { keys: `${ctrlKey}.d`, handler: 'handleNodesDuplicate', options: { exactMatch: true, useCapture: true } },
    { keys: `${altKey}.r`, handler: 'handleStartWorkflowRun', options: { exactMatch: true, useCapture: true } },
    { keys: `${ctrlKey}.z`, handler: 'handleHistoryBack', options: { exactMatch: true, useCapture: true }, condition: 'workflowHistoryShortcutsEnabled' },
    { keys: [`${ctrlKey}.y`, `${ctrlKey}.${shiftKey}.z`], handler: 'handleHistoryForward', options: { exactMatch: true, useCapture: true }, condition: 'workflowHistoryShortcutsEnabled' },
    { keys: 'h', handler: 'handleModeHand', options: { exactMatch: true, useCapture: true } },
    { keys: 'v', handler: 'handleModePointer', options: { exactMatch: true, useCapture: true } },
    { keys: `${ctrlKey}.o`, handler: 'handleGoLayout', options: { exactMatch: true, useCapture: true } },
    { keys: `${ctrlKey}.1`, handler: 'handleFitView', options: { exactMatch: true, useCapture: true } },
    { keys: `${shiftKey}.1`, handler: 'handleBackToOriginalSize', options: { exactMatch: true, useCapture: true } },
    { keys: `${shiftKey}.5`, handler: 'handleSizeToHalf', options: { exactMatch: true, useCapture: true } },
    { keys: `${ctrlKey}.-`, handler: 'handleZoomOut', options: { exactMatch: true, useCapture: true } },
    { keys: `${ctrlKey}.=`, handler: 'handleZoomIn', options: { exactMatch: true, useCapture: true } },
  ]
}

export const useShortcuts = (): void => {
  const {
    handleNodesCopy,
    handleNodesPaste,
    handleNodesDuplicate,
    handleNodesDelete,
    handleHistoryBack,
    handleHistoryForward,
  } = useNodesInteractions()

  const {
    handleModeHand,
    handleModePointer,
  } = useWorkflowMoveMode()

  const {
    handleGoLayout,
  } = useWorkflowOrganize()

  const {
    handleFitView,
    handleBackToOriginalSize,
    handleSizeToHalf,
    handleZoomOut,
    handleZoomIn,
  } = useWorkflowZoom()

  const { handleEdgeDelete } = useEdgesInteractions()
  const { handleStartWorkflowRun } = useWorkflowStartRun()
  const { shortcutsEnabled: workflowHistoryShortcutsEnabled } = useWorkflowHistoryStore()
  const workflowStore = useWorkflowStore()

  const handlers: ShortcutHandlers = useMemo(() => ({
    handleNodesCopy,
    handleNodesPaste,
    handleNodesDuplicate,
    handleNodesDelete,
    handleEdgeDelete,
    handleStartWorkflowRun,
    handleHistoryBack,
    handleHistoryForward,
    handleModeHand,
    handleModePointer,
    handleGoLayout,
    handleFitView,
    handleBackToOriginalSize,
    handleSizeToHalf,
    handleZoomOut,
    handleZoomIn,
  }), [handleNodesCopy, handleNodesPaste, handleNodesDuplicate, handleNodesDelete,
    handleEdgeDelete, handleStartWorkflowRun, handleHistoryBack, handleHistoryForward,
    handleModeHand, handleModePointer, handleGoLayout, handleFitView, handleBackToOriginalSize,
    handleSizeToHalf, handleZoomOut, handleZoomIn])

  const conditions: ShortcutConditions = useMemo(() => ({
    workflowHistoryShortcutsEnabled,
  }), [workflowHistoryShortcutsEnabled])

  const shortcutConfig = useMemo(() => createShortcutConfig(), [])

  const handleKeyPress = useCallback((e: KeyboardEvent): void => {
    const { showFeaturesPanel } = workflowStore.getState()
    if (isEventTargetInputArea(e.target as HTMLElement) || showFeaturesPanel)
      return

    const ctrlKey = e.ctrlKey || e.metaKey
    const altKey = e.altKey
    const shiftKey = e.shiftKey

    let pressedKey = e.key.toLowerCase()
    if (shiftKey && e.key.match(/^[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]$/))
      pressedKey = e.code.replace('Digit', '')

    const modifiers = [
      ctrlKey && getKeyboardKeyCodeBySystem('ctrl'),
      altKey && getKeyboardKeyCodeBySystem('alt'),
      shiftKey && getKeyboardKeyCodeBySystem('shift'),
    ].filter(Boolean).join('.')

    const fullPressedKey = modifiers ? `${modifiers}.${pressedKey}` : pressedKey

    for (const { keys, handler, options, condition } of shortcutConfig) {
      const matchedKey = Array.isArray(keys)
        ? keys.some(k => options?.exactMatch ? k.toLowerCase() === fullPressedKey : fullPressedKey.includes(k.toLowerCase()))
        : options?.exactMatch ? keys.toLowerCase() === fullPressedKey : fullPressedKey.includes(keys.toLowerCase())

      if (matchedKey) {
        if (condition && !conditions[condition])
          return

        if (handlers[handler]) {
          e.preventDefault()
          handlers[handler](e)
        }
        break
      }
    }
  }, [handlers, conditions, shortcutConfig, workflowStore])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyPress, true)
    return () => {
      window.removeEventListener('keydown', handleKeyPress, true)
    }
  }, [handleKeyPress])
}
