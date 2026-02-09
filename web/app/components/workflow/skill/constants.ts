/**
 * File Tree Constants - Single source of truth for root/blank identifiers
 */

// Root folder identifier (convert to null for API calls via toApiParentId)
export const ROOT_ID = 'root' as const

// Drag type identifier for internal tree node dragging
export const INTERNAL_NODE_DRAG_TYPE = 'application/x-dify-tree-node'

// Context menu trigger types (describes WHERE user clicked)
export const CONTEXT_MENU_TYPE = {
  BLANK: 'blank',
  NODE: 'node',
} as const

export type ContextMenuType = (typeof CONTEXT_MENU_TYPE)[keyof typeof CONTEXT_MENU_TYPE]

// Node menu types (determines which menu options to show)
export const NODE_MENU_TYPE = {
  ROOT: 'root',
  FOLDER: 'folder',
  FILE: 'file',
} as const

export type NodeMenuType = (typeof NODE_MENU_TYPE)[keyof typeof NODE_MENU_TYPE]
