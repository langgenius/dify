import type { PermissionSettingKey } from '../permission-quick-panel'
import type { IntegrationSection } from '@/app/components/integrations/routes'
import type { PermissionType } from '@/app/components/plugins/types'
import { usePluginSettingsAccess } from '@/app/components/plugins/plugin-page/use-reference-setting'

const isPluginCategorySection = (section: IntegrationSection) => {
  return (
    section === 'builtin' ||
    section === 'trigger' ||
    section === 'agent-strategy' ||
    section === 'extension'
  )
}

export function useIntegrationPermissions(section: IntegrationSection) {
  const {
    permission,
    canDebugger,
    canInstallPlugin,
    canDeletePlugin,
    canSetPluginPreferences,
    canSetPermissions,
    canUpdatePlugin,
    isPermissionLoading,
    permissionError,
    setPluginPermissionSettings,
    isPermissionUpdatePending,
  } = usePluginSettingsAccess()
  const isPluginCategory = isPluginCategorySection(section)
  const showPluginCategorySetting = isPluginCategory && canSetPluginPreferences
  const showPermissionQuickPanel = canSetPermissions && !!permission

  // Saves are not optimistic: each one builds on the value the previous save wrote, so the
  // controls wait while one is pending.
  const handlePermissionChange = (key: PermissionSettingKey, value: PermissionType) => {
    if (!permission || isPermissionUpdatePending) return

    setPluginPermissionSettings({
      ...permission,
      [key]: value,
    })
  }

  return {
    canDebugger,
    canInstallPlugin,
    canDeletePlugin,
    canSetPluginPreferences,
    canUpdatePlugin,
    canManagement: canInstallPlugin,
    handlePermissionChange,
    isPermissionUpdatePending,
    isPluginCategory,
    isReferenceSettingLoading: isPermissionLoading,
    permission,
    referenceSettingError: permissionError,
    showPermissionQuickPanel,
    showPluginCategorySetting,
  }
}
