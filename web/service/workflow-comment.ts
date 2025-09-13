import { del, get, post, put } from './base'
import type { CommonResponse } from '@/models/common'

export type WorkflowComment = {
  id: string
  app_id: string
  position_x: number
  position_y: number
  content: string
  created_by: string
  created_at: string
  updated_at: string
  resolved: boolean
  resolved_by?: string
  resolved_at?: string
  mentioned_user_ids: string[]
  replies_count: number
  author: {
    id: string
    name: string
    email: string
    avatar?: string
  }
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

export const fetchWorkflowComments = async (appId: string): Promise<WorkflowComment[]> => {
  const response = await get<{ data: WorkflowComment[] }>(`apps/${appId}/workflow/comments`)
  return response.data
}

export const createWorkflowComment = async (appId: string, params: CreateCommentParams): Promise<WorkflowComment> => {
  return post<WorkflowComment>(`apps/${appId}/workflow/comments`, { body: params })
}

export const fetchWorkflowComment = async (appId: string, commentId: string): Promise<WorkflowComment> => {
  return get<WorkflowComment>(`apps/${appId}/workflow/comments/${commentId}`)
}

export const updateWorkflowComment = async (appId: string, commentId: string, params: UpdateCommentParams): Promise<WorkflowComment> => {
  return put<WorkflowComment>(`apps/${appId}/workflow/comments/${commentId}`, { body: params })
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
