import type { StateCreator } from 'zustand'
import type { DirtySliceShape } from './dirty-slice'
import type { FileOperationsMenuSliceShape } from './file-operations-menu-slice'
import type { FileTreeSliceShape } from './file-tree-slice'
import type { MetadataSliceShape } from './metadata-slice'
import type { TabSliceShape } from './tab-slice'
import { createDirtySlice } from './dirty-slice'
import { createFileOperationsMenuSlice } from './file-operations-menu-slice'
import { createFileTreeSlice } from './file-tree-slice'
import { createMetadataSlice } from './metadata-slice'
import { createTabSlice } from './tab-slice'

export type SkillEditorSliceShape
  = TabSliceShape
    & FileTreeSliceShape
    & DirtySliceShape
    & MetadataSliceShape
    & FileOperationsMenuSliceShape
    & {
      resetSkillEditor: () => void
    }

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
      dirtyContents: new Map<string, string>(),
      fileMetadata: new Map<string, Record<string, any>>(),
      dirtyMetadataIds: new Set<string>(),
      contextMenu: null,
    })
  },
})
