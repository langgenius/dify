import type { StateCreator } from 'zustand'
import type { SkillEditorSliceShape } from './types'
import { createDirtySlice } from './dirty-slice'
import { createFileOperationsMenuSlice } from './file-operations-menu-slice'
import { createFileTreeSlice } from './file-tree-slice'
import { createMetadataSlice } from './metadata-slice'
import { createTabSlice } from './tab-slice'

export type { DirtySliceShape } from './dirty-slice'
export type { FileOperationsMenuSliceShape } from './file-operations-menu-slice'
export type { FileTreeSliceShape } from './file-tree-slice'
export type { MetadataSliceShape } from './metadata-slice'
export type { OpenTabOptions, TabSliceShape } from './tab-slice'
export type { SkillEditorSliceShape } from './types'

export const createSkillEditorSlice: StateCreator<SkillEditorSliceShape> = (...args) => ({
  ...createTabSlice(...args),
  ...createFileTreeSlice(...args),
  ...createDirtySlice(...args),
  ...createMetadataSlice(...args),
  ...createFileOperationsMenuSlice(...args),

  resetSkillEditor: () => {
    const [set] = args
    set({
      openTabIds: [],
      activeTabId: null,
      previewTabId: null,
      expandedFolderIds: new Set<string>(),
      selectedTreeNodeId: null,
      pendingCreateNode: null,
      dirtyContents: new Map<string, string>(),
      fileMetadata: new Map<string, Record<string, unknown>>(),
      dirtyMetadataIds: new Set<string>(),
      contextMenu: null,
    })
  },
})
