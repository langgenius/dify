export type ContactsDeployment = 'ce' | 'saas' | 'ee'

export type ContactsPermissions = {
  canManageContacts: boolean
  canManageMembers: boolean
  canViewContacts: boolean
}

export type ContactsFeatureContextValue = {
  deployment: ContactsDeployment
  permissions: ContactsPermissions
  workspaceId: string
}

export type ContactKind = 'workspace' | 'platform' | 'external'
export type ContactKindFilter = 'all' | ContactKind

export type ContactChannelSummary = {
  email: string
  imIdentities: Array<{
    identity: string
    provider: string
  }>
}

type ContactBase = {
  avatarUrl: string | null
  channels: ContactChannelSummary
  displayName: string
  email: string
  id: string
  joinedAt: string
}

export type WorkspaceContactView = ContactBase & {
  kind: 'workspace'
  memberId: string
  membershipStatus: 'active' | 'pending'
  workspaceRoleSummary: string
}

export type PlatformContactView = ContactBase & {
  kind: 'platform'
  organizationIdentity: string
  sourceWorkspaceSummary: string | null
}

export type ExternalContactView = ContactBase & {
  emailOnly: true
  kind: 'external'
  workspaceId: string
}

export type ContactView = WorkspaceContactView | PlatformContactView | ExternalContactView

export type ContactsListQuery = {
  cursor: string | null
  deployment: ContactsDeployment
  kind: ContactKindFilter
  pageSize: number
  search: string
}

export type ContactPage<T> = {
  items: T[]
  nextCursor: string | null
}

export type OrganizationCandidate = {
  avatarUrl: string | null
  displayName: string
  email: string
  id: string
  organizationIdentity: string
  sourceWorkspaceSummary: string
}

export type OrganizationCandidateQuery = {
  cursor: string | null
  pageSize: number
  search: string
}

export type CreateExternalContactCommand = {
  displayName: string
  email: string
  workspaceId: string
}

export type CreateExternalContactResult =
  | { contactId: string; kind: 'created' }
  | { contactId: string; kind: 'duplicate_external_contact' }
  | { contactId: string; kind: 'matches_workspace_contact' }
  | { contactId: string; kind: 'matches_platform_contact' }
  | { kind: 'failed' }

export type AddPlatformContactsCommand = {
  candidateIds: string[]
}

export type AddPlatformContactsResult = { contactIds: string[]; kind: 'added' } | { kind: 'failed' }

export type MemberRemovalImpact = {
  contactId: string | null
  deployment: ContactsDeployment
  memberId: string
}

export type RemoveMemberCommand = {
  keepAsPlatformContact: boolean
  memberId: string
}

export type RemoveMemberResult =
  | {
      contactId: string | null
      contactOutcome: 'removed' | 'converted_to_platform' | 'not_found'
      kind: 'removed'
    }
  | { kind: 'failed' }
