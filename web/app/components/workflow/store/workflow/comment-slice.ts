import type { StateCreator } from 'zustand'
import type { WorkflowCommentDetail, WorkflowCommentList } from '@/service/workflow-comment'

export type CommentSliceShape = {
  comments: WorkflowCommentList[]
  setComments: (comments: WorkflowCommentList[]) => void
  commentsLoading: boolean
  setCommentsLoading: (loading: boolean) => void
  activeCommentDetail: WorkflowCommentDetail | null
  setActiveCommentDetail: (comment: WorkflowCommentDetail | null) => void
  activeCommentDetailLoading: boolean
  setActiveCommentDetailLoading: (loading: boolean) => void
  commentDetailCache: Record<string, WorkflowCommentDetail>
  setCommentDetailCache: (cache: Record<string, WorkflowCommentDetail>) => void
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
  commentDetailCache: {},
  setCommentDetailCache: commentDetailCache => set({ commentDetailCache }),
})
