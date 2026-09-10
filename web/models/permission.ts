/**
 * Shared permission levels for resources (datasets, credentials, etc.).
 * Mirrors PermissionEnum from api/models/enums.py.
 */
export const PermissionLevel = {
  onlyMe: 'only_me',
  allTeamMembers: 'all_team_members',
  partialMembers: 'partial_members',
} as const

export type PermissionLevel = (typeof PermissionLevel)[keyof typeof PermissionLevel]

/**
 * Subset of PermissionLevel accepted for plugin credentials — partial_members
 * is not supported for OAuth/API-key credentials on the backend.
 */
export type CredentialPermission =
  | typeof PermissionLevel.onlyMe
  | typeof PermissionLevel.allTeamMembers
