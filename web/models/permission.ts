/**
 * Shared permission levels for resources (datasets, credentials, etc.).
 * Mirrors PermissionEnum from api/models/enums.py.
 */
export const PermissionLevel = {
  onlyMe: 'only_me',
  allTeamMembers: 'all_team_members',
  partialMembers: 'partial_members',
} as const

// eslint-disable-next-line ts/no-redeclare -- intentional: merging const + type under one name
export type PermissionLevel = typeof PermissionLevel[keyof typeof PermissionLevel]
