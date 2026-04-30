import type { RegisterableHotkey } from '@tanstack/react-hotkeys'

export type WorkflowShortcutId
  = | 'workflow.delete'
    | 'workflow.copy'
    | 'workflow.paste'
    | 'workflow.duplicate'
    | 'workflow.open-test-run-menu'
    | 'workflow.undo'
    | 'workflow.redo'
    | 'workflow.pointer-mode'
    | 'workflow.hand-mode'
    | 'workflow.comment-mode'
    | 'workflow.organize'
    | 'workflow.toggle-maximize'
    | 'workflow.zoom-to-fit'
    | 'workflow.zoom-to-100'
    | 'workflow.zoom-to-50'
    | 'workflow.zoom-out'
    | 'workflow.zoom-in'
    | 'workflow.download-import-log'
    | 'workflow.dim-other-nodes'
    | 'workflow.json-schema-confirm'
    | 'workflow.version-history'

export type WorkflowHotkeyMeta = {
  id: WorkflowShortcutId
  scope: 'workflow'
  name: string
  description: string
}

export type WorkflowShortcutDefinition = {
  id: WorkflowShortcutId
  hotkeys: readonly RegisterableHotkey[]
  displayHotkey?: RegisterableHotkey | (string & {})
  name: string
  description: string
}

export const WORKFLOW_SHORTCUTS: Record<WorkflowShortcutId, WorkflowShortcutDefinition> = {
  'workflow.delete': {
    id: 'workflow.delete',
    hotkeys: ['Delete', 'Backspace'],
    displayHotkey: 'Delete',
    name: 'Delete selection',
    description: 'Delete selected workflow nodes or edges',
  },
  'workflow.copy': {
    id: 'workflow.copy',
    hotkeys: ['Mod+C'],
    name: 'Copy',
    description: 'Copy selected workflow nodes',
  },
  'workflow.paste': {
    id: 'workflow.paste',
    hotkeys: ['Mod+V'],
    name: 'Paste',
    description: 'Paste copied workflow nodes',
  },
  'workflow.duplicate': {
    id: 'workflow.duplicate',
    hotkeys: ['Mod+D'],
    name: 'Duplicate',
    description: 'Duplicate selected workflow nodes',
  },
  'workflow.open-test-run-menu': {
    id: 'workflow.open-test-run-menu',
    hotkeys: ['Alt+R'],
    name: 'Open test run menu',
    description: 'Open the workflow test run menu',
  },
  'workflow.undo': {
    id: 'workflow.undo',
    hotkeys: ['Mod+Z'],
    name: 'Undo',
    description: 'Undo the previous workflow change',
  },
  'workflow.redo': {
    id: 'workflow.redo',
    hotkeys: ['Mod+Y', 'Mod+Shift+Z'],
    displayHotkey: 'Mod+Y',
    name: 'Redo',
    description: 'Redo the next workflow change',
  },
  'workflow.pointer-mode': {
    id: 'workflow.pointer-mode',
    hotkeys: ['V'],
    name: 'Pointer mode',
    description: 'Switch to pointer mode',
  },
  'workflow.hand-mode': {
    id: 'workflow.hand-mode',
    hotkeys: ['H'],
    name: 'Hand mode',
    description: 'Switch to hand mode',
  },
  'workflow.comment-mode': {
    id: 'workflow.comment-mode',
    hotkeys: ['C'],
    name: 'Comment mode',
    description: 'Switch to comment mode',
  },
  'workflow.organize': {
    id: 'workflow.organize',
    hotkeys: ['Mod+O'],
    name: 'Organize blocks',
    description: 'Automatically organize workflow blocks',
  },
  'workflow.toggle-maximize': {
    id: 'workflow.toggle-maximize',
    hotkeys: ['F'],
    name: 'Toggle maximize',
    description: 'Maximize or minimize the workflow canvas',
  },
  'workflow.zoom-to-fit': {
    id: 'workflow.zoom-to-fit',
    hotkeys: ['Mod+1'],
    name: 'Zoom to fit',
    description: 'Fit the workflow canvas into view',
  },
  'workflow.zoom-to-100': {
    id: 'workflow.zoom-to-100',
    hotkeys: ['Shift+1'],
    name: 'Zoom to 100%',
    description: 'Zoom the workflow canvas to 100%',
  },
  'workflow.zoom-to-50': {
    id: 'workflow.zoom-to-50',
    hotkeys: ['Shift+5'],
    name: 'Zoom to 50%',
    description: 'Zoom the workflow canvas to 50%',
  },
  'workflow.zoom-out': {
    id: 'workflow.zoom-out',
    hotkeys: ['Mod+-'],
    name: 'Zoom out',
    description: 'Zoom out of the workflow canvas',
  },
  'workflow.zoom-in': {
    id: 'workflow.zoom-in',
    hotkeys: ['Mod+='],
    displayHotkey: 'Mod+=',
    name: 'Zoom in',
    description: 'Zoom into the workflow canvas',
  },
  'workflow.download-import-log': {
    id: 'workflow.download-import-log',
    hotkeys: ['Mod+Shift+L'],
    name: 'Download import log',
    description: 'Download the workflow graph import log',
  },
  'workflow.dim-other-nodes': {
    id: 'workflow.dim-other-nodes',
    hotkeys: [{ key: 'Shift', shift: true }],
    displayHotkey: 'Shift',
    name: 'Dim other nodes',
    description: 'Dim nodes outside the current workflow selection',
  },
  'workflow.json-schema-confirm': {
    id: 'workflow.json-schema-confirm',
    hotkeys: ['Mod+Enter'],
    name: 'Confirm JSON schema edit',
    description: 'Confirm the current JSON schema edit',
  },
  'workflow.version-history': {
    id: 'workflow.version-history',
    hotkeys: ['Mod+Shift+H'],
    name: 'Version history',
    description: 'Open workflow version history',
  },
}

export const getWorkflowShortcutDisplayHotkey = (id: WorkflowShortcutId): RegisterableHotkey | (string & {}) => {
  const shortcut = WORKFLOW_SHORTCUTS[id]
  return shortcut.displayHotkey ?? shortcut.hotkeys[0]!
}
