import type { AccountWithRoleResponse } from '@dify/contracts/api/console/workspaces/types.gen'

const createMember = (overrides: Partial<AccountWithRoleResponse>): AccountWithRoleResponse => ({
  id: 'member-1',
  email: 'member-1@example.com',
  name: 'Member One',
  avatar: 'avatar-data',
  avatar_url: null,
  status: 'active',
  role: 'normal',
  roles: [],
  created_at: 1767225600,
  last_active_at: 1767312000,
  last_login_at: 1767398400,
  ...overrides,
})

export const members: AccountWithRoleResponse[] = [
  createMember({}),
  createMember({
    id: 'member-2',
    email: 'member-2@example.com',
    name: 'Member Two',
  }),
]
