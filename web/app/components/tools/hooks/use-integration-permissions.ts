import type { PermissionType, ReferenceSetting } from '@/app/components/plugins/types'
import type { IntegrationSection } from '@/app/components/tools/integration-routes'
import type { PermissionSettingKey } from '@/app/components/tools/permission-quick-panel'
import useReferenceSetting from '@/app/components/plugins/plugin-page/use-reference-setting'

const isPluginCategorySection = (section: IntegrationSection) => {
  return section === 'trigger' || section === 'agent-strategy' || section === 'extension'
}

export function useIntegrationPermissions(section: IntegrationSection) {
  const {
    referenceSetting,
    canManagement,
    canDebugger,
    canSetPermissions,
    setReferenceSettings,
  } = useReferenceSetting()
  const isPluginCategory = isPluginCategorySection(section)
  const showPluginCategorySetting = isPluginCategory && canSetPermissions && !!referenceSetting
  const showPermissionQuickPanel = canSetPermissions && !!referenceSetting

  const handlePermissionChange = (key: PermissionSettingKey, value: PermissionType) => {
    if (!referenceSetting)
      return

    setReferenceSettings({
      ...referenceSetting,
      permission: {
        ...referenceSetting.permission,
        [key]: value,
      },
    } satisfies ReferenceSetting)
  }

  return {
    canDebugger,
    canManagement,
    handlePermissionChange,
    isPluginCategory,
    referenceSetting,
    setReferenceSettings,
    showPermissionQuickPanel,
    showPluginCategorySetting,
  }
}
