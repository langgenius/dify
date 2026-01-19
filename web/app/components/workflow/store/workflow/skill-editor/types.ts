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

export type FileTreeSliceShape = {
  expandedFolderIds: Set<string>
  setExpandedFolderIds: (ids: Set<string>) => void
  toggleFolder: (folderId: string) => void
  revealFile: (ancestorFolderIds: string[]) => void
  setExpandedFromOpens: (opens: OpensObject) => void
  getOpensObject: () => OpensObject
  selectedTreeNodeId: string | null
  setSelectedTreeNodeId: (nodeId: string | null) => void
  createTargetNodeId: string | null
  setCreateTargetNodeId: (nodeId: string | null) => void
  pendingCreateNode: PendingCreateNode | null
  startCreateNode: (nodeType: PendingCreateNode['nodeType'], parentId: PendingCreateNode['parentId']) => void
  clearCreateNode: () => void
  dragOverFolderId: string | null
  setDragOverFolderId: (folderId: string | null) => void
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

export type ContextMenuType = 'node' | 'blank'

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
    & DirtySliceShape
    & MetadataSliceShape
    & FileOperationsMenuSliceShape
    & {
      resetSkillEditor: () => void
    }
