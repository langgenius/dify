import type { CommonResponse, InvitationResult, Member } from './common'

export type PlatformAdminWorkspaceOwner = {
  id: string
  name: string
  email: string
}

export type PlatformAdminWorkspace = {
  id: string
  name: string
  plan: string
  status: string
  created_at: number
  member_count: number
  owner: PlatformAdminWorkspaceOwner | null
}

export type PlatformAdminWorkspaceListResponse = {
  items: PlatformAdminWorkspace[]
  page: number
  limit: number
  total: number
}

export type PlatformAdminWorkspaceCreateResponse = {
  workspace: PlatformAdminWorkspace
  owner_invitation_url?: string | null
}

export type PlatformAdminWorkspaceMembersResponse = {
  accounts: Member[] | null
}

export type PlatformAdminWorkspaceInviteResponse = CommonResponse & {
  invitation_results: InvitationResult[]
  tenant_id: string
}

export type PlatformAdminMemberPasswordResetPayload = {
  memberId: string
  new_password: string
  password_confirm: string
}
