import type { PluginCategoryEnum } from '../types'
import { toast } from '@langgenius/dify-ui/toast'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppContext } from '@/context/app-context'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { hasPluginPermission, useInvalidateReferenceSettings, useMutationPluginPermissionSettings, useMutationReferenceSettings, usePluginAutoUpgradeSettings, usePluginPermissionSettings } from '@/service/use-plugins'

export const useCanSetPluginSettings = () => {
  const { isCurrentWorkspaceManager, isCurrentWorkspaceOwner } = useAppContext()

  return {
    canSetPermissions: isCurrentWorkspaceManager || isCurrentWorkspaceOwner,
  }
}

export const usePluginSettingsAccess = () => {
  const { t } = useTranslation()
  const { canSetPermissions } = useCanSetPluginSettings()
  const permissionQuery = usePluginPermissionSettings()
  const { data: permissions } = permissionQuery
  const { mutate: setPluginPermissionSettings, isPending: isPermissionUpdatePending } = useMutationPluginPermissionSettings({
    onSuccess: () => {
      toast.success(t('api.actionSuccess', { ns: 'common' }))
    },
  })

  return {
    permission: permissions,
    setPluginPermissionSettings,
    canManagement: hasPluginPermission(permissions?.install_permission, canSetPermissions),
    canDebugger: hasPluginPermission(permissions?.debug_permission, canSetPermissions),
    canSetPermissions,
    isPermissionLoading: permissionQuery.isLoading || permissionQuery.isFetching,
    permissionError: permissionQuery.error,
    isPermissionUpdatePending,
  }
}

const useReferenceSetting = (category: PluginCategoryEnum) => {
  const { t } = useTranslation()
  const permissionAccess = usePluginSettingsAccess()
  const autoUpgradeQuery = usePluginAutoUpgradeSettings(category)
  const data = permissionAccess.permission && autoUpgradeQuery.data?.auto_upgrade
    ? {
        permission: permissionAccess.permission,
        auto_upgrade: autoUpgradeQuery.data.auto_upgrade,
      }
    : undefined
  const invalidateReferenceSettings = useInvalidateReferenceSettings()
  const { mutate: updateReferenceSetting, isPending: isUpdatePending } = useMutationReferenceSettings({
    category,
    currentReferenceSetting: data,
    onSuccess: () => {
      invalidateReferenceSettings()
      toast.success(t('api.actionSuccess', { ns: 'common' }))
    },
  })

  return {
    referenceSetting: data,
    setReferenceSettings: updateReferenceSetting,
    canManagement: permissionAccess.canManagement,
    canDebugger: permissionAccess.canDebugger,
    canSetPermissions: permissionAccess.canSetPermissions,
    isPermissionLoading: permissionAccess.isPermissionLoading,
    permissionError: permissionAccess.permissionError,
    isReferenceSettingLoading: autoUpgradeQuery.isLoading || autoUpgradeQuery.isFetching,
    referenceSettingError: autoUpgradeQuery.error,
    isUpdatePending,
  }
}

export const useCanInstallPluginFromMarketplace = () => {
  const { data: enable_marketplace } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: s => s.enable_marketplace,
  })
  const { isCurrentWorkspaceManager, isCurrentWorkspaceOwner } = useAppContext()
  const { data: permissions } = usePluginPermissionSettings()
  const canManagement = hasPluginPermission(
    permissions?.install_permission,
    isCurrentWorkspaceManager || isCurrentWorkspaceOwner,
  )

  const canInstallPluginFromMarketplace = useMemo(() => {
    return enable_marketplace && canManagement
  }, [enable_marketplace, canManagement])

  return {
    canInstallPluginFromMarketplace,
  }
}

export default useReferenceSetting
