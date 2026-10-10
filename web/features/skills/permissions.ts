import type { PermissionKey } from '@/models/access-control'
import type { ResourceMaintainerPermissionOptions } from '@/utils/permission'
import { useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { hasPermission } from '@/utils/permission'

const SkillPermission = {
  View: 'skill.view',
  Edit: 'skill.edit',
  Publish: 'skill.publish',
  Delete: 'skill.delete',
} as const

export function useCanViewSkills() {
  const permissionKeys = useAtomValue(workspacePermissionKeysAtom)

  return hasPermission(permissionKeys, SkillPermission.View)
}

export function getSkillPermissions(
  permissionKeys: readonly PermissionKey[] | null | undefined,
  options?: ResourceMaintainerPermissionOptions,
) {
  const isMaintainer =
    options?.isRbacEnabled === true &&
    !!options.currentUserId &&
    options.currentUserId === options.resourceMaintainer

  return {
    canView: hasPermission(permissionKeys, SkillPermission.View),
    canEdit: hasPermission(permissionKeys, SkillPermission.Edit),
    canPublish: hasPermission(permissionKeys, SkillPermission.Publish),
    canDelete:
      hasPermission(permissionKeys, SkillPermission.Delete) ||
      (isMaintainer && hasPermission(permissionKeys, SkillPermission.Edit)),
  }
}

export function useSkillPermissions() {
  const permissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const { data: profile } = useQuery(userProfileQueryOptions())
  const { data: systemFeatures } = useQuery(systemFeaturesQueryOptions())

  return {
    ...getSkillPermissions(permissionKeys),
    canDeleteSkill: (maintainer: string | null | undefined) =>
      getSkillPermissions(permissionKeys, {
        currentUserId: profile?.profile.id,
        resourceMaintainer: maintainer,
        isRbacEnabled: systemFeatures?.rbac_enabled,
      }).canDelete,
  }
}
