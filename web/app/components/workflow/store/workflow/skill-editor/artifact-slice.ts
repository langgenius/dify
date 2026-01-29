import type { StateCreator } from 'zustand'
import type { ArtifactSliceShape, SkillEditorSliceShape } from './types'
import { makeArtifactTabId } from '@/app/components/workflow/skill/constants'

export type { ArtifactSliceShape } from './types'

export const createArtifactSlice: StateCreator<
  SkillEditorSliceShape,
  [],
  [],
  ArtifactSliceShape
> = (set, get) => ({
  selectedArtifactPath: null,

  selectArtifact: (path: string) => {
    get().clearSelection()
    set({ selectedArtifactPath: path })
    get().openTab(makeArtifactTabId(path), { pinned: true })
  },

  clearArtifactSelection: () => {
    set({ selectedArtifactPath: null })
  },
})
