import type { Hotkey } from '@tanstack/react-hotkeys'
import { matchesKeyboardEvent } from '@tanstack/react-hotkeys'
import { WORKFLOW_CANVAS_SHORTCUTS } from './shortcuts/definitions'

export const WORKFLOW_BROWSER_SAVE_HOTKEY = 'Mod+S' satisfies Hotkey

const WORKFLOW_BROWSER_DEFAULT_GUARD_HOTKEYS = [
  ...WORKFLOW_CANVAS_SHORTCUTS['workflow.duplicate'].hotkeys,
  ...WORKFLOW_CANVAS_SHORTCUTS['workflow.undo'].hotkeys,
  ...WORKFLOW_CANVAS_SHORTCUTS['workflow.redo'].hotkeys,
  WORKFLOW_BROWSER_SAVE_HOTKEY,
] satisfies readonly Hotkey[]

export function shouldPreventWorkflowBrowserDefault(event: KeyboardEvent) {
  return WORKFLOW_BROWSER_DEFAULT_GUARD_HOTKEYS.some((hotkey) =>
    matchesKeyboardEvent(event, hotkey),
  )
}
