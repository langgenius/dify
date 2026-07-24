import type {
  AvailablePlatformContact,
  ContactsDeployment,
  ContactsPermissions,
  ContactView,
} from '../types'

export const ContactsMockScenario = {
  AddPlatformFailure: 'add-platform-failure',
  CeMixed: 'ce-mixed',
  ContactRemovalFailure: 'contact-removal-failure',
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
  directory?: boolean
  nextPage?: boolean
  platformContacts?: boolean
  removal?: boolean
}

export type ContactsMockScenarioDefinition = {
  contacts: ContactView[]
  deployment: ContactsDeployment
  failures: ContactsMockFailurePlan
  availablePlatformContacts: AvailablePlatformContact[]
  memberContactIds: Record<string, string>
  permissions: ContactsPermissions
  workspaceId: string
}

const workspaceContact: ContactView = {
  avatar_url: '',
  created_at: Date.parse('2026-01-12T08:00:00.000Z'),
  email: 'owner@example.com',
  id: 'contact-owner',
  im_bindings: [{ id: 'binding-owner-slack', provider: 'slack', scope: 'workspace' }],
  name: 'Ralph Edwards',
  type: 'workspace',
}

const platformContact: ContactView = {
  avatar_url: '',
  created_at: Date.parse('2026-02-04T08:00:00.000Z'),
  email: 'platform@example.com',
  id: 'contact-platform',
  im_bindings: [{ id: 'binding-platform-feishu', provider: 'feishu', scope: 'organization' }],
  name: 'Leslie Alexander',
  type: 'platform',
}

const externalContact: ContactView = {
  avatar_url: '',
  created_at: Date.parse('2026-03-20T08:00:00.000Z'),
  email: 'external@example.com',
  id: 'contact-external',
  im_bindings: [],
  name: 'Courtney Henry',
  type: 'external',
}

const availablePlatformContacts: AvailablePlatformContact[] = [
  {
    avatar_url: null,
    email: 'ada@example.com',
    id: 'available-platform-ada',
    name: 'Ada Lovelace',
  },
  {
    avatar_url: null,
    email: 'grace@example.com',
    id: 'available-platform-grace',
    name: 'Grace Hopper',
  },
  {
    avatar_url: null,
    email: 'owner@example.com',
    id: 'available-platform-owner',
    name: 'Ralph Edwards',
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
      avatar_url: '',
      created_at: Date.parse('2026-04-01T08:00:00.000Z'),
      email: `partner-${index}@example.com`,
      id: `contact-partner-${index}`,
      im_bindings: [],
      name: `Partner ${index}`,
      type: 'external',
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
    memberContactIds: { 'member-owner': 'contact-owner' },
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
