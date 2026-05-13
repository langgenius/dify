import type { CommonResponse } from '@/models/common'
import { type } from '@orpc/contract'
import { base } from '../base'

export type UserProfile = {
  id: string
  name: string
  email: string
  avatar_url?: string
}

export type WorkflowCommentList = {
  id: string
  position_x: number
  position_y: number
  content: string
  created_by: string
  created_by_account: UserProfile | null
  created_at: number
  updated_at: number
  resolved: boolean
  resolved_by?: string | null
  resolved_by_account?: UserProfile | null
  resolved_at?: number | null
  mention_count: number
  reply_count: number
  participants: UserProfile[]
}

type WorkflowCommentDetailMention = {
  mentioned_user_id: string
  mentioned_user_account?: UserProfile | null
  reply_id: string | null
}

export type WorkflowCommentDetailReply = {
  id: string
  content: string
  created_by: string
  created_by_account?: UserProfile | null
  created_at: number
}

export type WorkflowCommentDetail = {
  id: string
  position_x: number
  position_y: number
  content: string
  created_by: string
  created_by_account: UserProfile | null
  created_at: number
  updated_at: number
  resolved: boolean
  resolved_by?: string | null
  resolved_by_account?: UserProfile | null
  resolved_at?: number | null
  replies: WorkflowCommentDetailReply[]
  mentions: WorkflowCommentDetailMention[]
}

type WorkflowCommentCreateRes = {
  id: string
  created_at: number
}

type WorkflowCommentUpdateRes = {
  id: string
  updated_at: number
}

type WorkflowCommentResolveRes = {
  id: string
  resolved: boolean
  resolved_by: string
  resolved_at: number
}

type WorkflowCommentReplyCreateRes = {
  id: string
  created_at: number
}

type WorkflowCommentReplyUpdateRes = {
  id: string
  updated_at: number
}

type CreateCommentParams = {
  position_x: number
  position_y: number
  content: string
  mentioned_user_ids?: string[]
}

type UpdateCommentParams = {
  content: string
  position_x?: number
  position_y?: number
  mentioned_user_ids?: string[]
}

type CreateReplyParams = {
  content: string
  mentioned_user_ids?: string[]
}

const workflowCommentListContract = base
  .route({
    path: '/apps/{appId}/workflow/comments',
    method: 'GET',
  })
  .input(type<{
    params: {
      appId: string
    }
  }>())
  .output(type<{ data: WorkflowCommentList[] }>())

const workflowCommentCreateContract = base
  .route({
    path: '/apps/{appId}/workflow/comments',
    method: 'POST',
  })
  .input(type<{
    params: {
      appId: string
    }
    body: CreateCommentParams
  }>())
  .output(type<WorkflowCommentCreateRes>())

const workflowCommentDetailContract = base
  .route({
    path: '/apps/{appId}/workflow/comments/{commentId}',
    method: 'GET',
  })
  .input(type<{
    params: {
      appId: string
      commentId: string
    }
  }>())
  .output(type<WorkflowCommentDetail>())

const workflowCommentUpdateContract = base
  .route({
    path: '/apps/{appId}/workflow/comments/{commentId}',
    method: 'PUT',
  })
  .input(type<{
    params: {
      appId: string
      commentId: string
    }
    body: UpdateCommentParams
  }>())
  .output(type<WorkflowCommentUpdateRes>())

const workflowCommentDeleteContract = base
  .route({
    path: '/apps/{appId}/workflow/comments/{commentId}',
    method: 'DELETE',
  })
  .input(type<{
    params: {
      appId: string
      commentId: string
    }
  }>())
  .output(type<CommonResponse>())

const workflowCommentResolveContract = base
  .route({
    path: '/apps/{appId}/workflow/comments/{commentId}/resolve',
    method: 'POST',
  })
  .input(type<{
    params: {
      appId: string
      commentId: string
    }
  }>())
  .output(type<WorkflowCommentResolveRes>())

const workflowCommentReplyCreateContract = base
  .route({
    path: '/apps/{appId}/workflow/comments/{commentId}/replies',
    method: 'POST',
  })
  .input(type<{
    params: {
      appId: string
      commentId: string
    }
    body: CreateReplyParams
  }>())
  .output(type<WorkflowCommentReplyCreateRes>())

const workflowCommentReplyUpdateContract = base
  .route({
    path: '/apps/{appId}/workflow/comments/{commentId}/replies/{replyId}',
    method: 'PUT',
  })
  .input(type<{
    params: {
      appId: string
      commentId: string
      replyId: string
    }
    body: CreateReplyParams
  }>())
  .output(type<WorkflowCommentReplyUpdateRes>())

const workflowCommentReplyDeleteContract = base
  .route({
    path: '/apps/{appId}/workflow/comments/{commentId}/replies/{replyId}',
    method: 'DELETE',
  })
  .input(type<{
    params: {
      appId: string
      commentId: string
      replyId: string
    }
  }>())
  .output(type<CommonResponse>())

const workflowCommentMentionUsersContract = base
  .route({
    path: '/apps/{appId}/workflow/comments/mention-users',
    method: 'GET',
  })
  .input(type<{
    params: {
      appId: string
    }
  }>())
  .output(type<{ users: UserProfile[] }>())

export const workflowCommentContracts = {
  list: workflowCommentListContract,
  create: workflowCommentCreateContract,
  detail: workflowCommentDetailContract,
  update: workflowCommentUpdateContract,
  delete: workflowCommentDeleteContract,
  resolve: workflowCommentResolveContract,
  mentionUsers: workflowCommentMentionUsersContract,
  replies: {
    create: workflowCommentReplyCreateContract,
    update: workflowCommentReplyUpdateContract,
    delete: workflowCommentReplyDeleteContract,
  },
}
