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

export function useSkillPermissions() {
  const permissionKeys = useAtomValue(workspacePermissionKeysAtom)

  const { data: profile } = useQuery(userProfileQueryOptions())
  const { data: systemFeatures } = useQuery(systemFeaturesQueryOptions())
  const canEdit = hasPermission(permissionKeys, SkillPermission.Edit)
  const canDelete = hasPermission(permissionKeys, SkillPermission.Delete)

  return {
    canView: hasPermission(permissionKeys, SkillPermission.View),
    canEdit,
    canPublish: hasPermission(permissionKeys, SkillPermission.Publish),
    canDeleteSkill: (createdBy: string | null | undefined) =>
      canDelete ||
      (systemFeatures?.rbac_enabled === true && !!createdBy && createdBy === profile?.profile.id),
  }
}
