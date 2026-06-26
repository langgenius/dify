import type { IntegrationSection } from '@/app/components/integrations/routes'
import type { IntegrationSidebarNavItemData } from '@/app/components/integrations/sidebar-nav-item'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { PluginCategoryEnum } from '@/app/components/plugins/types'

export type IntegrationHeader = {
  description: string
  title: string
}

type IntegrationNavOptions = {
  canManageTools?: boolean
  canManageMCP?: boolean
}

export const getPluginCategoryBySection = (section: IntegrationSection) => {
  if (section === 'builtin')
    return PluginCategoryEnum.tool
  if (section === 'trigger')
    return PluginCategoryEnum.trigger
  if (section === 'agent-strategy')
    return PluginCategoryEnum.agent
  if (section === 'extension')
    return PluginCategoryEnum.extension
}

export function useIntegrationNav(section: IntegrationSection, options: IntegrationNavOptions = {}) {
  const { t } = useTranslation()
  const {
    canManageMCP = true,
    canManageTools = true,
  } = options
  const providerItem = useMemo<IntegrationSidebarNavItemData>(() => ({
    section: 'provider',
    label: t('settings.provider', { ns: 'common' }),
    icon: 'i-ri-brain-2-line',
  }), [t])
  const dataSourceItem = useMemo<IntegrationSidebarNavItemData>(() => ({
    section: 'data-source',
    label: t('settings.dataSource', { ns: 'common' }),
    icon: 'i-ri-database-2-line',
    iconClassName: 'size-4',
  }), [t])
  const customEndpointItem = useMemo<IntegrationSidebarNavItemData>(() => ({
    section: 'custom-endpoint',
    label: t('settings.customEndpoint', { ns: 'common' }),
    icon: 'i-custom-vender-integrations-api-extension',
    iconClassName: 'h-[13px] w-3.5',
  }), [t])
  const toolItems = useMemo<IntegrationSidebarNavItemData[]>(() => {
    const items: IntegrationSidebarNavItemData[] = [
      {
        section: 'builtin',
        label: t('toolsPage.toolPlugin', { ns: 'common' }),
        icon: 'i-custom-vender-integrations-tools',
        iconClassName: 'h-[14px] w-[12.5px]',
        className: 'pl-8',
      },
    ]

    if (canManageMCP) {
      items.push({
        section: 'mcp',
        label: 'MCP',
        icon: 'i-custom-vender-integrations-mcp',
        iconClassName: 'h-[14.5px] w-[13.5px]',
        className: 'pl-8',
      })
    }

    if (canManageTools) {
      items.push(
        {
          section: 'workflow-tool',
          label: t('common.workflowAsTool', { ns: 'workflow' }),
          icon: 'i-custom-vender-integrations-workflow-as-tool',
          iconClassName: 'size-4',
          className: 'pl-8',
        },
        {
          section: 'custom-tool',
          label: t('settings.swaggerAPIAsTool', { ns: 'common' }),
          icon: 'i-custom-vender-integrations-custom-tool',
          iconClassName: 'h-[14.5px] w-[12.5px]',
          className: 'pl-8',
        },
      )
    }

    return items
  }, [canManageMCP, canManageTools, t])
  const secondaryItems = useMemo<IntegrationSidebarNavItemData[]>(() => [
    {
      section: 'trigger',
      label: t('categorySingle.trigger', { ns: 'plugin' }),
      icon: 'i-custom-vender-integrations-trigger',
      iconClassName: 'h-[13.5px] w-[13.5px]',
    },
    {
      section: 'agent-strategy',
      label: t('categorySingle.agent', { ns: 'plugin' }),
      icon: 'i-custom-vender-integrations-agent-strategy',
      iconClassName: 'h-[14.5px] w-[15.5px]',
    },
    {
      section: 'extension',
      label: t('categorySingle.extension', { ns: 'plugin' }),
      icon: 'i-custom-vender-integrations-extension',
      iconClassName: 'h-[13.5px] w-3',
    },
  ], [t])
  const activeItem = [providerItem, dataSourceItem, ...toolItems, ...secondaryItems, customEndpointItem].find(item => item.section === section)
  const integrationHeader = useMemo<IntegrationHeader | null>(() => {
    switch (section) {
      case 'builtin':
        return {
          title: t('toolsPage.toolPlugin', { ns: 'common' }),
          description: t('toolsPage.description', { ns: 'common' }),
        }
      case 'mcp':
        return {
          title: 'MCP',
          description: t('mcpPage.description', { ns: 'common' }),
        }
      case 'custom-tool':
        return {
          title: t('settings.swaggerAPIAsTool', { ns: 'common' }),
          description: t('swaggerAPIAsToolPage.description', { ns: 'common' }),
        }
      case 'workflow-tool':
        return {
          title: t('common.workflowAsTool', { ns: 'workflow' }),
          description: t('workflowAsToolPage.description', { ns: 'common' }),
        }
      case 'custom-endpoint':
        return {
          title: t('settings.customEndpoint', { ns: 'common' }),
          description: t('apiBasedExtensionPage.description', { ns: 'common' }),
        }
      case 'data-source':
        return {
          title: t('settings.dataSource', { ns: 'common' }),
          description: t('dataSourcePage.description', { ns: 'common' }),
        }
      case 'trigger':
        return {
          title: t('categorySingle.trigger', { ns: 'plugin' }),
          description: t('triggerPage.description', { ns: 'common' }),
        }
      case 'extension':
        return {
          title: t('categorySingle.extension', { ns: 'plugin' }),
          description: t('extensionPage.description', { ns: 'common' }),
        }
      case 'agent-strategy':
        return {
          title: t('categorySingle.agent', { ns: 'plugin' }),
          description: t('agentStrategyPage.description', { ns: 'common' }),
        }
      default:
        return null
    }
  }, [section, t])

  return {
    activeItem,
    customEndpointItem,
    dataSourceItem,
    integrationHeader,
    providerItem,
    secondaryItems,
    toolItems,
  }
}
