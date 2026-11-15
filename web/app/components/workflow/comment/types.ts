import type { AccountWithRoleResponse } from '@dify/contracts/api/console/apps/types.gen'

export type UserProfile = Pick<AccountWithRoleResponse, 'id' | 'name' | 'email' | 'avatar_url'> & {
  avatar_url?: string | null
}
