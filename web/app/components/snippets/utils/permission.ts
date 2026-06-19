import type { PermissionKey } from '@/models/access-control'
import { hasPermission } from '@/utils/permission'

export const SnippetPermission = {
  CreateAndModify: 'snippets.create_and_modify',
  Management: 'snippets.management',
} as const satisfies Record<string, PermissionKey>

export const canCreateAndModifySnippets = (workspacePermissionKeys: readonly PermissionKey[] | null | undefined) => {
  return hasPermission(workspacePermissionKeys, SnippetPermission.CreateAndModify)
}

export const canManageSnippets = (workspacePermissionKeys: readonly PermissionKey[] | null | undefined) => {
  return hasPermission(workspacePermissionKeys, SnippetPermission.Management)
}

export const canAccessSnippets = (workspacePermissionKeys: readonly PermissionKey[] | null | undefined) => {
  return hasPermission(workspacePermissionKeys, [
    SnippetPermission.CreateAndModify,
    SnippetPermission.Management,
  ])
}
