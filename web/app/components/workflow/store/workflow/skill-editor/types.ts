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

export type FileTreeSliceShape = {
  expandedFolderIds: Set<string>
  setExpandedFolderIds: (ids: Set<string>) => void
  toggleFolder: (folderId: string) => void
  revealFile: (ancestorFolderIds: string[]) => void
  setExpandedFromOpens: (opens: OpensObject) => void
  getOpensObject: () => OpensObject
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

export type FileOperationsMenuSliceShape = {
  contextMenu: {
    top: number
    left: number
    nodeId: string
  } | null
  setContextMenu: (menu: FileOperationsMenuSliceShape['contextMenu']) => void
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
