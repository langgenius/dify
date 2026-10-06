import type { Hotkey, IndividualKey } from '@tanstack/react-hotkeys'

export type WorkflowCanvasHotkeyMeta = {
  id: WorkflowCanvasShortcutId
  scope: 'workflow-canvas'
  name: string
  description: string
}

type WorkflowCanvasShortcutDefinitionBase = {
  name: string
  description: string
}

export type WorkflowCanvasHotkeyDefinition = WorkflowCanvasShortcutDefinitionBase & {
  hotkeys: readonly [Hotkey, ...Hotkey[]]
  displayHotkey?: Hotkey
}

type WorkflowCanvasHoldKeyDefinition = WorkflowCanvasShortcutDefinitionBase & {
  holdKey: IndividualKey
}

type WorkflowCanvasShortcutDefinition =
  | WorkflowCanvasHotkeyDefinition
  | WorkflowCanvasHoldKeyDefinition

export const WORKFLOW_CANVAS_SHORTCUTS = {
  'workflow.save-draft': {
    hotkeys: ['Mod+S'],
    name: 'Save draft',
    description: 'Save the current workflow draft',
  },
  'workflow.delete': {
    hotkeys: ['Delete', 'Backspace'],
    displayHotkey: 'Delete',
    name: 'Delete selection',
    description: 'Delete selected workflow nodes or edges',
  },
  'workflow.copy': {
    hotkeys: ['Mod+C'],
    name: 'Copy',
    description: 'Copy selected workflow nodes',
  },
  'workflow.paste': {
    hotkeys: ['Mod+V'],
    name: 'Paste',
    description: 'Paste copied workflow nodes',
  },
  'workflow.duplicate': {
    hotkeys: ['Mod+D'],
    name: 'Duplicate',
    description: 'Duplicate selected workflow nodes',
  },
  'workflow.undo': {
    hotkeys: ['Mod+Z'],
    name: 'Undo',
    description: 'Undo the previous workflow change',
  },
  'workflow.redo': {
    hotkeys: ['Mod+Y', 'Mod+Shift+Z'],
    displayHotkey: 'Mod+Y',
    name: 'Redo',
    description: 'Redo the next workflow change',
  },
  'workflow.pointer-mode': {
    hotkeys: ['V'],
    name: 'Pointer mode',
    description: 'Switch to pointer mode',
  },
  'workflow.hand-mode': {
    hotkeys: ['H'],
    name: 'Hand mode',
    description: 'Switch to hand mode',
  },
  'workflow.comment-mode': {
    hotkeys: ['C'],
    name: 'Comment mode',
    description: 'Switch to comment mode',
  },
  'workflow.organize': {
    hotkeys: ['Mod+O'],
    name: 'Organize blocks',
    description: 'Automatically organize workflow blocks',
  },
  'workflow.zoom-to-fit': {
    hotkeys: ['Mod+1'],
    name: 'Zoom to fit',
    description: 'Fit the workflow canvas into view',
  },
  'workflow.zoom-to-100': {
    hotkeys: ['Shift+1'],
    name: 'Zoom to 100%',
    description: 'Zoom the workflow canvas to 100%',
  },
  'workflow.zoom-to-50': {
    hotkeys: ['Shift+5'],
    name: 'Zoom to 50%',
    description: 'Zoom the workflow canvas to 50%',
  },
  'workflow.zoom-out': {
    hotkeys: ['Mod+-'],
    name: 'Zoom out',
    description: 'Zoom out of the workflow canvas',
  },
  'workflow.zoom-in': {
    hotkeys: ['Mod+='],
    displayHotkey: 'Mod+=',
    name: 'Zoom in',
    description: 'Zoom into the workflow canvas',
  },
  'workflow.download-import-log': {
    hotkeys: ['Mod+Shift+L'],
    name: 'Download import log',
    description: 'Download the workflow graph import log',
  },
  'workflow.dim-other-nodes': {
    holdKey: 'Shift',
    name: 'Dim other nodes',
    description: 'Dim nodes outside the current workflow selection',
  },
} as const satisfies Record<string, WorkflowCanvasShortcutDefinition>

export type WorkflowCanvasShortcutId = keyof typeof WORKFLOW_CANVAS_SHORTCUTS
export type WorkflowCanvasHotkeyId = {
  [
    Id in WorkflowCanvasShortcutId
  ]: (typeof WORKFLOW_CANVAS_SHORTCUTS)[Id] extends WorkflowCanvasHotkeyDefinition ? Id : never
}[WorkflowCanvasShortcutId]

export const getWorkflowCanvasShortcutDisplayKey = (
  id: WorkflowCanvasShortcutId,
): Hotkey | IndividualKey => {
  const shortcut = WORKFLOW_CANVAS_SHORTCUTS[id]

  if ('displayHotkey' in shortcut && shortcut.displayHotkey) return shortcut.displayHotkey
  if ('hotkeys' in shortcut) return shortcut.hotkeys[0]

  return shortcut.holdKey
}
