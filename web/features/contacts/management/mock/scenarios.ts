import type {
  ContactsDeployment,
  ContactsPermissions,
  ContactView,
  ExternalContactView,
  PlatformContactView,
  WorkspaceContactView,
} from '../types'

export const ContactsMockScenario = {
  AddPlatformFailure: 'add-platform-failure',
  CeMixed: 'ce-mixed',
  ContactRemovalFailure: 'contact-removal-failure',
  DetailFailure: 'detail-failure',
  DirectoryFailure: 'directory-failure',
  EeMixed: 'ee-mixed',
  Empty: 'empty',
  ExternalFailure: 'external-failure',
  NextPageFailure: 'next-page-failure',
  NoAccess: 'no-access',
  Paginated: 'paginated',
  PlatformContactsFailure: 'platform-contacts-failure',
  ReadOnly: 'read-only',
  RemovalFailure: 'removal-failure',
  SaasMixed: 'saas-mixed',
} as const

export type ContactsMockScenario = (typeof ContactsMockScenario)[keyof typeof ContactsMockScenario]

export type ContactsMockFailurePlan = {
  addPlatform?: boolean
  contactRemoval?: boolean
  createExternal?: boolean
  detail?: boolean
  directory?: boolean
  nextPage?: boolean
  platformContacts?: boolean
  removal?: boolean
}

export type ContactsMockScenarioDefinition = {
  contacts: ContactView[]
  deployment: ContactsDeployment
  failures: ContactsMockFailurePlan
  availablePlatformContacts: PlatformContactView[]
  permissions: ContactsPermissions
  workspaceId: string
}

const workspaceContact: WorkspaceContactView = {
  avatarUrl: null,
  channels: {
    email: 'owner@example.com',
    imIdentities: [{ identity: 'owner', provider: 'Slack' }],
  },
  displayName: 'Ralph Edwards',
  email: 'owner@example.com',
  id: 'contact-owner',
  joinedAt: '2026-01-12T08:00:00.000Z',
  kind: 'workspace',
  memberId: 'member-owner',
  membershipStatus: 'active',
  workspaceRoleSummary: 'Admin',
}

const platformContact: PlatformContactView = {
  avatarUrl: null,
  channels: {
    email: 'platform@example.com',
    imIdentities: [{ identity: 'platform-contact', provider: 'Feishu' }],
  },
  displayName: 'Leslie Alexander',
  email: 'platform@example.com',
  id: 'contact-platform',
  joinedAt: '2026-02-04T08:00:00.000Z',
  kind: 'platform',
  organizationIdentity: 'org-user-platform',
  sourceWorkspaceSummary: 'Mobile Dev',
}

const externalContact: ExternalContactView = {
  avatarUrl: null,
  channels: { email: 'external@example.com', imIdentities: [] },
  displayName: 'Courtney Henry',
  email: 'external@example.com',
  emailOnly: true,
  id: 'contact-external',
  joinedAt: '2026-03-20T08:00:00.000Z',
  kind: 'external',
  workspaceId: 'workspace-1',
}

const availablePlatformContacts: PlatformContactView[] = [
  {
    avatarUrl: null,
    channels: { email: 'ada@example.com', imIdentities: [] },
    displayName: 'Ada Lovelace',
    email: 'ada@example.com',
    id: 'available-platform-ada',
    joinedAt: '2026-07-17T00:00:00.000Z',
    kind: 'platform',
    organizationIdentity: 'org-user-ada',
    sourceWorkspaceSummary: 'Dev Team',
  },
  {
    avatarUrl: null,
    channels: { email: 'grace@example.com', imIdentities: [] },
    displayName: 'Grace Hopper',
    email: 'grace@example.com',
    id: 'available-platform-grace',
    joinedAt: '2026-07-17T00:00:00.000Z',
    kind: 'platform',
    organizationIdentity: 'org-user-grace',
    sourceWorkspaceSummary: 'Platform Team',
  },
  {
    avatarUrl: null,
    channels: { email: 'owner@example.com', imIdentities: [] },
    displayName: 'Ralph Edwards',
    email: 'owner@example.com',
    id: 'available-platform-owner',
    joinedAt: '2026-07-17T00:00:00.000Z',
    kind: 'platform',
    organizationIdentity: 'org-user-owner',
    sourceWorkspaceSummary: 'Current workspace',
  },
]

const managerPermissions: ContactsPermissions = {
  canManageContacts: true,
  canManageMembers: true,
  canViewContacts: true,
}

const clone = <T>(value: T): T => structuredClone(value)

function mixedContacts(deployment: ContactsDeployment): ContactView[] {
  if (deployment === 'ee') return clone([workspaceContact, platformContact, externalContact])

  return clone([workspaceContact, externalContact])
}

function paginatedContacts(): ContactView[] {
  const contacts = mixedContacts('ee')
  for (let index = 1; index <= 20; index += 1) {
    contacts.push({
      avatarUrl: null,
      channels: { email: `partner-${index}@example.com`, imIdentities: [] },
      displayName: `Partner ${index}`,
      email: `partner-${index}@example.com`,
      emailOnly: true,
      id: `contact-partner-${index}`,
      joinedAt: '2026-04-01T08:00:00.000Z',
      kind: 'external',
      workspaceId: 'workspace-1',
    })
  }
  return contacts
}

export function createContactsMockScenario(
  scenario: ContactsMockScenario,
): ContactsMockScenarioDefinition {
  const base: ContactsMockScenarioDefinition = {
    availablePlatformContacts: clone(availablePlatformContacts),
    contacts: mixedContacts('ee'),
    deployment: 'ee',
    failures: {},
    permissions: clone(managerPermissions),
    workspaceId: 'workspace-1',
  }

  switch (scenario) {
    case ContactsMockScenario.CeMixed:
      return { ...base, contacts: mixedContacts('ce'), deployment: 'ce' }
    case ContactsMockScenario.SaasMixed:
      return { ...base, contacts: mixedContacts('saas'), deployment: 'saas' }
    case ContactsMockScenario.Empty:
      return { ...base, contacts: [] }
    case ContactsMockScenario.DirectoryFailure:
      return { ...base, failures: { directory: true } }
    case ContactsMockScenario.DetailFailure:
      return { ...base, failures: { detail: true } }
    case ContactsMockScenario.NextPageFailure:
      return { ...base, contacts: paginatedContacts(), failures: { nextPage: true } }
    case ContactsMockScenario.Paginated:
      return { ...base, contacts: paginatedContacts() }
    case ContactsMockScenario.ExternalFailure:
      return { ...base, failures: { createExternal: true } }
    case ContactsMockScenario.PlatformContactsFailure:
      return { ...base, failures: { platformContacts: true } }
    case ContactsMockScenario.AddPlatformFailure:
      return { ...base, failures: { addPlatform: true } }
    case ContactsMockScenario.ContactRemovalFailure:
      return { ...base, failures: { contactRemoval: true } }
    case ContactsMockScenario.RemovalFailure:
      return { ...base, failures: { removal: true } }
    case ContactsMockScenario.ReadOnly:
      return {
        ...base,
        permissions: {
          canManageContacts: false,
          canManageMembers: false,
          canViewContacts: true,
        },
      }
    case ContactsMockScenario.NoAccess:
      return {
        ...base,
        permissions: {
          canManageContacts: false,
          canManageMembers: false,
          canViewContacts: false,
        },
      }
    case ContactsMockScenario.EeMixed:
      return base
  }
}

export function createDefaultContactsScenario(deployment: ContactsDeployment, canManage: boolean) {
  const scenario = createContactsMockScenario(
    deployment === 'ee'
      ? ContactsMockScenario.EeMixed
      : deployment === 'saas'
        ? ContactsMockScenario.SaasMixed
        : ContactsMockScenario.CeMixed,
  )

  return {
    ...scenario,
    permissions: {
      canManageContacts: canManage,
      canManageMembers: canManage,
      canViewContacts: canManage,
    },
  }
}
