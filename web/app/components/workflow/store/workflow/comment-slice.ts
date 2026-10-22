import type { StateCreator } from 'zustand'
import type { UserProfile } from '@/app/components/workflow/comment/types'

export type CommentSliceShape = {
  showResolvedComments: boolean
  setShowResolvedComments: (showResolved: boolean) => void
  mentionableUsersCache: Record<string, UserProfile[]>
  setMentionableUsersCache: (appId: string, users: UserProfile[]) => void
  mentionableUsersLoading: Record<string, boolean>
  setMentionableUsersLoading: (appId: string, loading: boolean) => void
}

export const createCommentSlice: StateCreator<CommentSliceShape> = (set) => ({
  showResolvedComments: false,
  setShowResolvedComments: (showResolvedComments) => set({ showResolvedComments }),
  mentionableUsersCache: {},
  setMentionableUsersCache: (appId, users) =>
    set((state) => ({
      mentionableUsersCache: {
        ...state.mentionableUsersCache,
        [appId]: users,
      },
    })),
  mentionableUsersLoading: {},
  setMentionableUsersLoading: (appId, loading) =>
    set((state) => ({
      mentionableUsersLoading: {
        ...state.mentionableUsersLoading,
        [appId]: loading,
      },
    })),
})
