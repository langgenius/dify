import type { StateCreator } from 'zustand'
import type { UserProfile, WorkflowCommentDetail, WorkflowCommentList } from '@/service/workflow-comment'

export type CommentSliceShape = {
  comments: WorkflowCommentList[]
  setComments: (comments: WorkflowCommentList[]) => void
  commentsLoading: boolean
  setCommentsLoading: (loading: boolean) => void
  activeCommentDetail: WorkflowCommentDetail | null
  setActiveCommentDetail: (comment: WorkflowCommentDetail | null) => void
  activeCommentDetailLoading: boolean
  setActiveCommentDetailLoading: (loading: boolean) => void
  replySubmitting: boolean
  setReplySubmitting: (loading: boolean) => void
  replyUpdating: boolean
  setReplyUpdating: (loading: boolean) => void
  commentDetailCache: Record<string, WorkflowCommentDetail>
  setCommentDetailCache: (cache: Record<string, WorkflowCommentDetail>) => void
  mentionableUsersCache: Record<string, UserProfile[]>
  setMentionableUsersCache: (appId: string, users: UserProfile[]) => void
  mentionableUsersLoading: Record<string, boolean>
  setMentionableUsersLoading: (appId: string, loading: boolean) => void
}

export const createCommentSlice: StateCreator<CommentSliceShape> = set => ({
  comments: [],
  setComments: comments => set({ comments }),
  commentsLoading: false,
  setCommentsLoading: commentsLoading => set({ commentsLoading }),
  activeCommentDetail: null,
  setActiveCommentDetail: activeCommentDetail => set({ activeCommentDetail }),
  activeCommentDetailLoading: false,
  setActiveCommentDetailLoading: activeCommentDetailLoading => set({ activeCommentDetailLoading }),
  replySubmitting: false,
  setReplySubmitting: replySubmitting => set({ replySubmitting }),
  replyUpdating: false,
  setReplyUpdating: replyUpdating => set({ replyUpdating }),
  commentDetailCache: {},
  setCommentDetailCache: commentDetailCache => set({ commentDetailCache }),
  mentionableUsersCache: {},
  setMentionableUsersCache: (appId, users) => set(state => ({
    mentionableUsersCache: {
      ...state.mentionableUsersCache,
      [appId]: users,
    },
  })),
  mentionableUsersLoading: {},
  setMentionableUsersLoading: (appId, loading) => set(state => ({
    mentionableUsersLoading: {
      ...state.mentionableUsersLoading,
      [appId]: loading,
    },
  })),
})
