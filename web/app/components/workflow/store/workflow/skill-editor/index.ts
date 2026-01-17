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

export const createSkillEditorSlice: StateCreator<SkillEditorSliceShape> = (set, get, store) => {
  // Type assertion via unknown to allow composition with other slices in a larger store
  // This is safe because all slice creators only use set/get for their own properties
  const tabArgs = [set, get, store] as unknown as Parameters<StateCreator<TabSliceShape>>
  const fileTreeArgs = [set, get, store] as unknown as Parameters<StateCreator<FileTreeSliceShape>>
  const dirtyArgs = [set, get, store] as unknown as Parameters<StateCreator<DirtySliceShape>>
  const metadataArgs = [set, get, store] as unknown as Parameters<StateCreator<MetadataSliceShape>>
  const menuArgs = [set, get, store] as unknown as Parameters<StateCreator<FileOperationsMenuSliceShape>>

  return {
    ...createTabSlice(...tabArgs),
    ...createFileTreeSlice(...fileTreeArgs),
    ...createDirtySlice(...dirtyArgs),
    ...createMetadataSlice(...metadataArgs),
    ...createFileOperationsMenuSlice(...menuArgs),

    resetSkillEditor: () => {
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
  }
}
