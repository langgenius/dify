import type { StateCreator } from 'zustand'
import type { SkillEditorSliceShape, UploadSliceShape } from './types'

export type { UploadSliceShape } from './types'

export const createUploadSlice: StateCreator<
  SkillEditorSliceShape,
  [],
  [],
  UploadSliceShape
> = set => ({
  uploadStatus: 'idle',
  uploadProgress: { uploaded: 0, total: 0, failed: 0 },
  setUploadStatus: status => set({ uploadStatus: status }),
  setUploadProgress: progress => set({ uploadProgress: progress }),
  resetUpload: () => set({
    uploadStatus: 'idle',
    uploadProgress: { uploaded: 0, total: 0, failed: 0 },
  }),
})
