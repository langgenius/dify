import type { ContextMenuType } from '@/app/components/workflow/skill/constants'

export type OpenTabOptions = {
  pinned?: boolean
}

export type TabSliceShape = {
  openTabIds: string[]
  activeTabId: string | null
  previewTabId: string | null
  openTab: (fileId: string, options?: OpenTabOptions) => void
  closeTab: (fileId: string) => void
  activateTab: (fileId: string) => void
  pinTab: (fileId: string) => void
  isPreviewTab: (fileId: string) => boolean
}

export type OpensObject = Record<string, boolean>

export type PendingCreateNode = {
  id: string
  parentId: string | null
  nodeType: 'file' | 'folder'
}

export type DragActionType = 'upload' | 'move'

export type FileTreeSliceShape = {
  expandedFolderIds: Set<string>
  setExpandedFolderIds: (ids: Set<string>) => void
  toggleFolder: (folderId: string) => void
  revealFile: (ancestorFolderIds: string[]) => void
  setExpandedFromOpens: (opens: OpensObject) => void
  getOpensObject: () => OpensObject
  selectedTreeNodeId: string | null
  setSelectedTreeNodeId: (nodeId: string | null) => void
  selectedNodeIds: Set<string>
  setSelectedNodeIds: (nodeIds: string[]) => void
  clearSelection: () => void
  pendingCreateNode: PendingCreateNode | null
  startCreateNode: (nodeType: PendingCreateNode['nodeType'], parentId: PendingCreateNode['parentId']) => void
  clearCreateNode: () => void
  dragOverFolderId: string | null
  setDragOverFolderId: (folderId: string | null) => void
  currentDragType: DragActionType | null
  setCurrentDragType: (type: DragActionType | null) => void
  fileTreeSearchTerm: string
  setFileTreeSearchTerm: (term: string) => void
}

export type ClipboardOperation = 'copy' | 'cut'

export type ClipboardItem = {
  operation: ClipboardOperation
  nodeIds: Set<string>
}

export type ClipboardSliceShape = {
  clipboard: ClipboardItem | null
  copyNodes: (nodeIds: string[]) => void
  cutNodes: (nodeIds: string[]) => void
  clearClipboard: () => void
  isCutNode: (nodeId: string) => boolean
  hasClipboard: () => boolean
}

export type DirtySliceShape = {
  dirtyContents: Map<string, string>
  setDraftContent: (fileId: string, content: string) => void
  clearDraftContent: (fileId: string) => void
  isDirty: (fileId: string) => boolean
  getDraftContent: (fileId: string) => string | undefined
}

export type MetadataSliceShape = {
  fileMetadata: Map<string, Record<string, unknown>>
  dirtyMetadataIds: Set<string>
  setFileMetadata: (fileId: string, metadata: Record<string, unknown>) => void
  setDraftMetadata: (fileId: string, metadata: Record<string, unknown>) => void
  clearDraftMetadata: (fileId: string) => void
  clearFileMetadata: (fileId: string) => void
  isMetadataDirty: (fileId: string) => boolean
  getFileMetadata: (fileId: string) => Record<string, unknown> | undefined
}

export type ContextMenuState = {
  top: number
  left: number
  type: ContextMenuType
  nodeId?: string
  isFolder?: boolean
}

export type FileOperationsMenuSliceShape = {
  contextMenu: ContextMenuState | null
  setContextMenu: (menu: ContextMenuState | null) => void
}

export type SkillEditorSliceShape
  = TabSliceShape
    & FileTreeSliceShape
    & ClipboardSliceShape
    & DirtySliceShape
    & MetadataSliceShape
    & FileOperationsMenuSliceShape
    & {
      resetSkillEditor: () => void
    }
