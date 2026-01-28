import type { StateCreator } from 'zustand'
import type { SkillEditorSliceShape } from './types'
import { START_TAB_ID } from '@/app/components/workflow/skill/constants'
import { createClipboardSlice } from './clipboard-slice'
import { createDirtySlice } from './dirty-slice'
import { createFileOperationsMenuSlice } from './file-operations-menu-slice'
import { createFileTreeSlice } from './file-tree-slice'
import { createMetadataSlice } from './metadata-slice'
import { createTabSlice } from './tab-slice'
import { createUploadSlice } from './upload-slice'

export type { ClipboardSliceShape } from './clipboard-slice'
export type { DirtySliceShape } from './dirty-slice'
export type { FileOperationsMenuSliceShape } from './file-operations-menu-slice'
export type { FileTreeSliceShape } from './file-tree-slice'
export type { MetadataSliceShape } from './metadata-slice'
export type { OpenTabOptions, TabSliceShape } from './tab-slice'
export type { SkillEditorSliceShape } from './types'
export type { UploadSliceShape } from './upload-slice'

export const createSkillEditorSlice: StateCreator<SkillEditorSliceShape> = (...args) => ({
  ...createTabSlice(...args),
  ...createFileTreeSlice(...args),
  ...createClipboardSlice(...args),
  ...createDirtySlice(...args),
  ...createMetadataSlice(...args),
  ...createFileOperationsMenuSlice(...args),
  ...createUploadSlice(...args),

  resetSkillEditor: () => {
    const [set] = args
    set({
      openTabIds: [],
      activeTabId: START_TAB_ID,
      previewTabId: null,
      expandedFolderIds: new Set<string>(),
      selectedTreeNodeId: null,
      selectedNodeIds: new Set<string>(),
      pendingCreateNode: null,
      clipboard: null,
      dirtyContents: new Map<string, string>(),
      fileMetadata: new Map<string, Record<string, unknown>>(),
      dirtyMetadataIds: new Set<string>(),
      contextMenu: null,
      fileTreeSearchTerm: '',
      uploadStatus: 'idle',
      uploadProgress: { uploaded: 0, total: 0, failed: 0 },
    })
  },
})
