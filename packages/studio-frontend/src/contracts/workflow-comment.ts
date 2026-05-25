/**
 * Studio workflow-comment type definitions.
 *
 * ORPC contract objects remain in web/contract/console/workflow-comment.ts
 * because they are runtime instances consumed by web/contract/router.ts.
 * This file provides the canonical type definitions for Studio components.
 */

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
