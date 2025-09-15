import { del, get, post, put } from './base'
import type { CommonResponse } from '@/models/common'

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
  created_by_account: UserProfile
  created_at: string
  updated_at: string
  resolved: boolean
  resolved_by?: string
  resolved_by_account?: UserProfile
  resolved_at?: string
  mention_count: number
  reply_count: number
  participants: UserProfile[]
}

export type WorkflowCommentDetail = {
  id: string
  position_x: number
  position_y: number
  content: string
  created_by: string
  created_by_account: UserProfile
  created_at: string
  updated_at: string
  resolved: boolean
  resolved_by?: string
  resolved_by_account?: UserProfile
  resolved_at?: string
  replies: []
  mentions: []
}

export type WorkflowCommentCreateRes = {
  id: string
  created_at: string
}

export type WorkflowCommentUpdateRes = {
  id: string
  updated_at: string
}

export type WorkflowCommentReply = {
  id: string
  comment_id: string
  content: string
  created_by: string
  created_at: string
  updated_at: string
  mentioned_user_ids: string[]
  author: {
    id: string
    name: string
    email: string
    avatar?: string
  }
}

export type CreateCommentParams = {
  position_x: number
  position_y: number
  content: string
  mentioned_user_ids?: string[]
}

export type UpdateCommentParams = {
  content: string
  position_x?: number
  position_y?: number
  mentioned_user_ids?: string[]
}

export type CreateReplyParams = {
  content: string
  mentioned_user_ids?: string[]
}

export const fetchWorkflowComments = async (appId: string): Promise<WorkflowCommentList[]> => {
  const response = await get<{ data: WorkflowCommentList[] }>(`apps/${appId}/workflow/comments`)
  return response.data
}

export const createWorkflowComment = async (appId: string, params: CreateCommentParams): Promise<WorkflowCommentCreateRes> => {
  return post<WorkflowCommentCreateRes>(`apps/${appId}/workflow/comments`, { body: params })
}

export const fetchWorkflowComment = async (appId: string, commentId: string): Promise<WorkflowCommentDetail> => {
  return get<WorkflowCommentDetail>(`apps/${appId}/workflow/comments/${commentId}`)
}

export const updateWorkflowComment = async (appId: string, commentId: string, params: UpdateCommentParams): Promise<WorkflowCommentUpdateRes> => {
  return put<WorkflowCommentUpdateRes>(`apps/${appId}/workflow/comments/${commentId}`, { body: params })
}

export const deleteWorkflowComment = async (appId: string, commentId: string): Promise<CommonResponse> => {
  return del<CommonResponse>(`apps/${appId}/workflow/comments/${commentId}`)
}

export const resolveWorkflowComment = async (appId: string, commentId: string): Promise<WorkflowComment> => {
  return post<WorkflowComment>(`apps/${appId}/workflow/comments/${commentId}/resolve`)
}

export const createWorkflowCommentReply = async (appId: string, commentId: string, params: CreateReplyParams): Promise<WorkflowCommentReply> => {
  return post<WorkflowCommentReply>(`apps/${appId}/workflow/comments/${commentId}/replies`, { body: params })
}

export const updateWorkflowCommentReply = async (appId: string, commentId: string, replyId: string, params: CreateReplyParams): Promise<WorkflowCommentReply> => {
  return put<WorkflowCommentReply>(`apps/${appId}/workflow/comments/${commentId}/replies/${replyId}`, { body: params })
}

export const deleteWorkflowCommentReply = async (appId: string, commentId: string, replyId: string): Promise<CommonResponse> => {
  return del<CommonResponse>(`apps/${appId}/workflow/comments/${commentId}/replies/${replyId}`)
}

export const fetchMentionableUsers = async (appId: string) => {
  const response = await get<{ users: Array<{ id: string; name: string; email: string; avatar?: string }> }>(`apps/${appId}/workflow/comments/mention-users`)
  return response.users
}
