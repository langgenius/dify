import type {
  CreateCommentParams as ContractCreateCommentParams,
  CreateReplyParams as ContractCreateReplyParams,
  UpdateCommentParams as ContractUpdateCommentParams,
  UserProfile as ContractUserProfile,
  WorkflowCommentCreateRes as ContractWorkflowCommentCreateRes,
  WorkflowCommentDetail as ContractWorkflowCommentDetail,
  WorkflowCommentDetailMention as ContractWorkflowCommentDetailMention,
  WorkflowCommentDetailReply as ContractWorkflowCommentDetailReply,
  WorkflowCommentList as ContractWorkflowCommentList,
  WorkflowCommentReply as ContractWorkflowCommentReply,
  WorkflowCommentResolveRes as ContractWorkflowCommentResolveRes,
  WorkflowCommentUpdateRes as ContractWorkflowCommentUpdateRes,
} from '@/contract/console/workflow-comment'
import type { CommonResponse } from '@/models/common'
import { consoleClient } from './client'

export type CreateCommentParams = ContractCreateCommentParams
export type CreateReplyParams = ContractCreateReplyParams
export type UpdateCommentParams = ContractUpdateCommentParams
export type UserProfile = ContractUserProfile
export type WorkflowCommentCreateRes = ContractWorkflowCommentCreateRes
export type WorkflowCommentDetail = ContractWorkflowCommentDetail
export type WorkflowCommentDetailMention = ContractWorkflowCommentDetailMention
export type WorkflowCommentDetailReply = ContractWorkflowCommentDetailReply
export type WorkflowCommentList = ContractWorkflowCommentList
export type WorkflowCommentReply = ContractWorkflowCommentReply
export type WorkflowCommentResolveRes = ContractWorkflowCommentResolveRes
export type WorkflowCommentUpdateRes = ContractWorkflowCommentUpdateRes

export const fetchWorkflowComments = async (appId: string): Promise<WorkflowCommentList[]> => {
  const response = await consoleClient.workflowComments.list({
    params: { appId },
  })
  return response.data
}

export const createWorkflowComment = async (appId: string, params: CreateCommentParams): Promise<WorkflowCommentCreateRes> => {
  return consoleClient.workflowComments.create({
    params: { appId },
    body: params,
  })
}

export const fetchWorkflowComment = async (appId: string, commentId: string): Promise<WorkflowCommentDetail> => {
  return consoleClient.workflowComments.detail({
    params: { appId, commentId },
  })
}

export const updateWorkflowComment = async (appId: string, commentId: string, params: UpdateCommentParams): Promise<WorkflowCommentUpdateRes> => {
  return consoleClient.workflowComments.update({
    params: { appId, commentId },
    body: params,
  })
}

export const deleteWorkflowComment = async (appId: string, commentId: string): Promise<CommonResponse> => {
  return consoleClient.workflowComments.delete({
    params: { appId, commentId },
  })
}

export const resolveWorkflowComment = async (appId: string, commentId: string): Promise<WorkflowCommentResolveRes> => {
  return consoleClient.workflowComments.resolve({
    params: { appId, commentId },
  })
}

export const createWorkflowCommentReply = async (appId: string, commentId: string, params: CreateReplyParams): Promise<WorkflowCommentReply> => {
  return consoleClient.workflowComments.replies.create({
    params: { appId, commentId },
    body: params,
  })
}

export const updateWorkflowCommentReply = async (appId: string, commentId: string, replyId: string, params: CreateReplyParams): Promise<WorkflowCommentReply> => {
  return consoleClient.workflowComments.replies.update({
    params: {
      appId,
      commentId,
      replyId,
    },
    body: params,
  })
}

export const deleteWorkflowCommentReply = async (appId: string, commentId: string, replyId: string): Promise<CommonResponse> => {
  return consoleClient.workflowComments.replies.delete({
    params: {
      appId,
      commentId,
      replyId,
    },
  })
}

export const fetchMentionableUsers = async (appId: string) => {
  const response = await consoleClient.workflowComments.mentionUsers({
    params: { appId },
  })
  return response.users
}
