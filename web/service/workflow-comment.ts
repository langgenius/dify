import type {
  CreateCommentParams,
  CreateReplyParams,
  UpdateCommentParams,
  WorkflowCommentCreateRes,
  WorkflowCommentDetail,
  WorkflowCommentList,
  WorkflowCommentReply,
  WorkflowCommentResolveRes,
  WorkflowCommentUpdateRes,
} from '@/contract/console/workflow-comment'
import type { CommonResponse } from '@/models/common'
import { consoleClient } from './client'

export type {
  CreateCommentParams,
  CreateReplyParams,
  UpdateCommentParams,
  UserProfile,
  WorkflowCommentCreateRes,
  WorkflowCommentDetail,
  WorkflowCommentDetailMention,
  WorkflowCommentDetailReply,
  WorkflowCommentList,
  WorkflowCommentReply,
  WorkflowCommentResolveRes,
  WorkflowCommentUpdateRes,
} from '@/contract/console/workflow-comment'

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
