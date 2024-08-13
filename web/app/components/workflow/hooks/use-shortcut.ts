import { useCallback, useEffect, useRef } from 'react'
import { useNodesInteractions } from './use-nodes-interactions'
import { useEdgesInteractions } from './use-edges-interactions'
import { useWorkflowStartRun } from './use-workflow-start-run'

type ShortcutAction = (event: KeyboardEvent) => void
type ShortcutKey = string
type ShortcutMap = Record<ShortcutKey, ShortcutAction>

const isEventTargetInputArea = (target: EventTarget | null): boolean => {
  if (!target || !(target instanceof HTMLElement))
    return false

  return (
    target.tagName === 'INPUT'
    || target.tagName === 'TEXTAREA'
    || target.contentEditable === 'true'
  )
}

const getKeyboardKeyCodeBySystem = (key: string): string => {
  return navigator.userAgent.toUpperCase().includes('MAC') ? 'meta' : 'ctrl'
}

export const useShortcut = () => {
  const {
    handleNodesCopy,
    handleNodesPaste,
    handleNodesDuplicate,
    handleNodesDelete,
  } = useNodesInteractions()

  const { handleEdgeDelete } = useEdgesInteractions()
  const { handleStartWorkflowRun } = useWorkflowStartRun()

  const shortcutsRef = useRef<ShortcutMap>({
    [`${getKeyboardKeyCodeBySystem('ctrl')}+c`]: (e) => {
      if (!isEventTargetInputArea(e.target)) {
        e.preventDefault()
        handleNodesCopy()
      }
    },
    [`${getKeyboardKeyCodeBySystem('ctrl')}+v`]: (e) => {
      if (!isEventTargetInputArea(e.target)) {
        e.preventDefault()
        handleNodesPaste()
      }
    },
    [`${getKeyboardKeyCodeBySystem('ctrl')}+d`]: (e) => {
      if (!isEventTargetInputArea(e.target)) {
        e.preventDefault()
        handleNodesDuplicate()
      }
    },
    [`${getKeyboardKeyCodeBySystem('ctrl')}+r`]: (e) => {
      e.preventDefault()
      handleStartWorkflowRun()
    },
    delete: (e) => {
      if (!isEventTargetInputArea(e.target)) {
        e.preventDefault()
        handleNodesDelete()
        handleEdgeDelete()
      }
    },
    backspace: (e) => {
      if (!isEventTargetInputArea(e.target)) {
        e.preventDefault()
        handleNodesDelete()
        handleEdgeDelete()
      }
    },
  })

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    const { ctrlKey, metaKey, altKey, shiftKey, key } = event
    const modifiers = [
      ctrlKey && 'ctrl',
      metaKey && 'meta',
      altKey && 'alt',
      shiftKey && 'shift',
    ].filter(Boolean)

    const pressedKey = key.toLowerCase()
    const shortcutKey = [...modifiers, pressedKey].join('+')

    const action = shortcutsRef.current[shortcutKey]
    if (action)
      action(event)
  }, [])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [handleKeyDown])

  return {
    isShortcutActive: (shortcut: string) => shortcut in shortcutsRef.current,
  }
}
