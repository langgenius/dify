import type { PermissionSettingKey } from '../permission-quick-panel'
import type { IntegrationSection } from '@/app/components/integrations/routes'
import type { PermissionType } from '@/app/components/plugins/types'
import { usePluginSettingsAccess } from '@/app/components/plugins/plugin-page/use-reference-setting'

const isPluginCategorySection = (section: IntegrationSection) => {
  return section === 'builtin' || section === 'trigger' || section === 'agent-strategy' || section === 'extension'
}

export function useIntegrationPermissions(section: IntegrationSection) {
  const {
    permission,
    canManagement,
    canDebugger,
    canSetPermissions,
    isPermissionLoading,
    permissionError,
    setPluginPermissionSettings,
  } = usePluginSettingsAccess()
  const isPluginCategory = isPluginCategorySection(section)
  const showPluginCategorySetting = isPluginCategory && canSetPermissions
  const showPermissionQuickPanel = canSetPermissions && !!permission

  const handlePermissionChange = (key: PermissionSettingKey, value: PermissionType) => {
    if (!permission)
      return

    setPluginPermissionSettings({
      ...permission,
      [key]: value,
    })
  }

  return {
    canDebugger,
    canManagement,
    handlePermissionChange,
    isPluginCategory,
    isReferenceSettingLoading: isPermissionLoading,
    permission,
    referenceSettingError: permissionError,
    showPermissionQuickPanel,
    showPluginCategorySetting,
  }
}
