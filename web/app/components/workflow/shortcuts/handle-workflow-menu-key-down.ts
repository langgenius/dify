import type { KeyboardEvent } from 'react'
import type { WorkflowCanvasHotkeyId } from './definitions'
import { matchesKeyboardEvent } from '@tanstack/react-hotkeys'
import { WORKFLOW_CANVAS_SHORTCUTS } from './definitions'

export function handleWorkflowMenuKeyDown(
  event: KeyboardEvent<HTMLElement>,
  actions: ReadonlyArray<readonly [WorkflowCanvasHotkeyId, (() => void) | undefined]>,
) {
  if (
    event.defaultPrevented ||
    event.nativeEvent.isComposing ||
    !(event.target instanceof HTMLElement) ||
    !event.currentTarget.contains(event.target) ||
    event.target.closest(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
    )
  )
    return

  for (const [shortcut, action] of actions) {
    if (
      !action ||
      !WORKFLOW_CANVAS_SHORTCUTS[shortcut].hotkeys.some((hotkey) =>
        matchesKeyboardEvent(event.nativeEvent, hotkey),
      )
    )
      continue

    event.preventDefault()
    event.stopPropagation()
    if (!event.repeat) action()
    return
  }
}
