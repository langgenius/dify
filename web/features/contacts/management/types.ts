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

export type ContactType = 'workspace' | 'platform' | 'external'
export type ContactTypeFilter = 'all' | ContactType

export type ContactIMBinding = {
  id: string
  provider: string
  scope: 'organization' | 'workspace'
}

export type ContactView = {
  avatar_url: string
  created_at: number
  email: string | null
  id: string
  im_bindings: ContactIMBinding[]
  name: string
  type: ContactType
}

export type AvailablePlatformContact = {
  avatar_url: string | null
  email: string
  id: string
  name: string
}

export type ContactsListQuery = {
  deployment: ContactsDeployment
  kind: ContactTypeFilter
  limit: number
  page: number
  search: string
}

export type ContactPage<T> = {
  data: T[]
  has_more: boolean
  limit: number
  page: number
  total: number
}

export type AvailablePlatformContactsQuery = {
  limit: number
  page: number
  search: string
}

export type CreateExternalContactCommand = {
  displayName: string
  email: string
}

export type CreateExternalContactResult =
  | { contactId: string; kind: 'created' }
  | { contactId: string; kind: 'duplicate_external_contact' }
  | { contactId: string; kind: 'matches_workspace_contact' }
  | { contactId: string; kind: 'matches_platform_contact' }
  | { kind: 'failed' }

export type AddPlatformContactsCommand = {
  contactIds: string[]
}

export type AddPlatformContactsResult = { contactIds: string[]; kind: 'added' } | { kind: 'failed' }

export type RemoveContactsCommand = {
  contactIds: string[]
}

export type RemoveContactsResult =
  | { kind: 'removed'; removedContactIds: string[] }
  | { kind: 'failed' }

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
