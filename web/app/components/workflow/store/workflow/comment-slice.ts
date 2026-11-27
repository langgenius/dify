import type { StateCreator } from 'zustand'

export type CommentSliceShape = {
  showResolvedComments: boolean
  setShowResolvedComments: (showResolved: boolean) => void
}

export const createCommentSlice: StateCreator<CommentSliceShape> = (set) => ({
  showResolvedComments: false,
  setShowResolvedComments: (showResolvedComments) => set({ showResolvedComments }),
})
