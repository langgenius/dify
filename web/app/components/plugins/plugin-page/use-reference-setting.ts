import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/components/base/ui/toast'
import { useAppContext } from '@/context/app-context'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { useInvalidateReferenceSettings, useMutationReferenceSettings, useReferenceSettings } from '@/service/use-plugins'
import { PermissionType } from '../types'

const hasPermission = (permission: PermissionType | undefined, isAdmin: boolean) => {
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
  const { isCurrentWorkspaceManager, isCurrentWorkspaceOwner } = useAppContext()
  const { data } = useReferenceSettings()
  // console.log(data)
  const { permission: permissions } = data || {}
  const invalidateReferenceSettings = useInvalidateReferenceSettings()
  const { mutate: updateReferenceSetting, isPending: isUpdatePending } = useMutationReferenceSettings({
    onSuccess: () => {
      invalidateReferenceSettings()
      toast.success(t('api.actionSuccess', { ns: 'common' }))
    },
  })
  const isAdmin = isCurrentWorkspaceManager || isCurrentWorkspaceOwner

  return {
    referenceSetting: data,
    setReferenceSettings: updateReferenceSetting,
    canManagement: hasPermission(permissions?.install_permission, isAdmin),
    canDebugger: hasPermission(permissions?.debug_permission, isAdmin),
    canSetPermissions: isAdmin,
    isUpdatePending,
  }
}

export const useCanInstallPluginFromMarketplace = () => {
  const { enable_marketplace } = useGlobalPublicStore(s => s.systemFeatures)
  const { canManagement } = useReferenceSetting()

  const canInstallPluginFromMarketplace = useMemo(() => {
    return enable_marketplace && canManagement
  }, [enable_marketplace, canManagement])

  return {
    canInstallPluginFromMarketplace,
  }
}

export default useReferenceSetting
