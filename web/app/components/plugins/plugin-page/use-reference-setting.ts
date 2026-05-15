import { toast } from '@langgenius/dify-ui/toast'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppContext } from '@/context/app-context'
import { systemFeaturesQueryOptions } from '@/service/system-features'
import { useInvalidateReferenceSettings, useMutationReferenceSettings, useReferenceSettings } from '@/service/use-plugins'
import { hasPermission } from '@/utils/permission'
import { PermissionType } from '../types'

const hasPluginPermission = (permission: PermissionType | undefined, isAdmin: boolean) => {
  if (!permission)
    return false

  if (permission === PermissionType.noOne)
    return false

  if (permission === PermissionType.everyone)
    return true

  return isAdmin
}

const useReferenceSetting = () => {
  const { t } = useTranslation()
  const { isCurrentWorkspaceManager, isCurrentWorkspaceOwner, workspacePermissionKeys } = useAppContext()
  const { data } = useReferenceSettings()

  const { permission: permissions } = data || {}
  const invalidateReferenceSettings = useInvalidateReferenceSettings()
  const { mutate: updateReferenceSetting, isPending: isUpdatePending } = useMutationReferenceSettings({
    onSuccess: () => {
      invalidateReferenceSettings()
      toast.success(t('api.actionSuccess', { ns: 'common' }))
    },
  })
  const isAdmin = isCurrentWorkspaceManager || isCurrentWorkspaceOwner

  const canInstall = hasPermission(workspacePermissionKeys, ['plugin.install', 'plugin.manage'])
  const canUninstall = hasPermission(workspacePermissionKeys, ['plugin.uninstall', 'plugin.manage'])
  const canSetPreferences = hasPermission(workspacePermissionKeys, ['plugin.preference.manage'])

  return {
    referenceSetting: data,
    setReferenceSettings: updateReferenceSetting,
    canInstall: hasPluginPermission(permissions?.install_permission, canInstall),
    canUninstall,
    canDebugger: hasPluginPermission(permissions?.debug_permission, isAdmin),
    canSetPreferences,
    isUpdatePending,
  }
}

export const useCanInstallPluginFromMarketplace = () => {
  const { data: enable_marketplace } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: s => s.enable_marketplace,
  })
  const { canInstall } = useReferenceSetting()

  const canInstallPluginFromMarketplace = useMemo(() => {
    return enable_marketplace && canInstall
  }, [enable_marketplace, canInstall])

  return {
    canInstallPluginFromMarketplace,
  }
}

export default useReferenceSetting
