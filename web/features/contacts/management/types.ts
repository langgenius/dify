import type {
  GetContactResponse,
  HumanInputContactType,
} from '@dify/contracts/api/console/workspaces/types.gen'

type ContactsDeployment = 'ce' | 'saas' | 'ee'

type ContactsPermissions = {
  canManageContacts: boolean
  canManageMembers: boolean
  canViewContacts: boolean
}

export type ContactsFeatureContextValue = {
  deployment: ContactsDeployment
  imCentrallyManaged: boolean | undefined
  /** The failed first capability read, claimed by the runtime provider. */
  imCapabilityError?: unknown
  retryIMCapability?: () => void
  permissions: ContactsPermissions
  workspaceId: string
}

export type ContactTypeFilter = 'all' | HumanInputContactType

export type ContactView = GetContactResponse['contact'] &
  Partial<Pick<GetContactResponse, 'im_binding_details'>>
