import type { HumanInputContact } from '@dify/contracts/api/console/workspaces/types.gen'
import type { ContactsFeatureContextValue } from '../../types'

export const managerContext: ContactsFeatureContextValue = {
  deployment: 'ce',
  imCentrallyManaged: false,
  workspaceId: 'workspace-1',
  permissions: { canViewContacts: true, canManageContacts: true, canManageMembers: true },
}

export const alice: HumanInputContact = {
  id: '01a18a00-0000-7000-8000-000000000001',
  name: 'Alice',
  email: 'alice@example.com',
  type: 'external',
  created_at: 1780000000,
  im_bindings: [],
}

export const bob: HumanInputContact = {
  id: '01a18a00-0000-7000-8000-000000000002',
  name: 'Bob',
  email: 'bob@example.com',
  type: 'external',
  created_at: 1780000000,
  im_bindings: [],
}
