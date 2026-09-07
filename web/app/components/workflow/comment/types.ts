import type {
  AccountWithRoleResponse,
  WorkflowCommentDetail as GeneratedWorkflowCommentDetail,
  WorkflowCommentBasic,
  WorkflowCommentReply,
} from '@dify/contracts/api/console/apps/types.gen'

export type UserProfile = Pick<AccountWithRoleResponse, 'id' | 'name' | 'email' | 'avatar_url'> & {
  avatar_url?: string | null
}

export type WorkflowCommentList = WorkflowCommentBasic
export type WorkflowCommentDetail = GeneratedWorkflowCommentDetail
export type WorkflowCommentDetailReply = WorkflowCommentReply
