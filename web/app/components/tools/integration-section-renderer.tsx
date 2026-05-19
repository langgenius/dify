'use client'

import type { ReactNode } from 'react'
import type { IntegrationSection } from './integration-routes'
import { ApiBasedExtensionPage } from '@/app/components/header/account-setting/api-based-extension-page'
import DataSourcePage from '@/app/components/header/account-setting/data-source-page-new'
import ModelProviderPage from '@/app/components/header/account-setting/model-provider-page'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { toolsContentFrameClassNames, toolsContentInsetClassNames } from './content-inset'
import PluginCategoryPage from './plugin-category-page'
import ToolProviderList from './provider-list'

type IntegrationSectionRendererProps = {
  canInstallPlugin?: boolean
  onProviderSearchTextChange: (value: string) => void
  onSwitchToMarketplace?: () => void
  pluginCategoryToolbarAction?: ReactNode
  providerSearchText: string
  section: IntegrationSection
}

const IntegrationSectionRenderer = ({
  canInstallPlugin = true,
  onProviderSearchTextChange,
  onSwitchToMarketplace,
  pluginCategoryToolbarAction,
  providerSearchText,
  section,
}: IntegrationSectionRendererProps) => {
  switch (section) {
    case 'provider':
      return (
        <div className={`${toolsContentFrameClassNames.compact} ${toolsContentInsetClassNames.compact} pt-2`}>
          <ModelProviderPage
            fixedWarningAlignment="content-frame"
            searchText={providerSearchText}
            stickyToolbar
            onSearchTextChange={onProviderSearchTextChange}
          />
        </div>
      )
    case 'builtin':
      return <ToolProviderList category="builtin" contentInset="compact" />
    case 'mcp':
      return <ToolProviderList category="mcp" contentInset="compact" />
    case 'custom-tool':
      return <ToolProviderList category="api" contentInset="compact" />
    case 'workflow-tool':
      return <ToolProviderList category="workflow" contentInset="compact" />
    case 'data-source':
      return (
        <div className={`${toolsContentFrameClassNames.compact} ${toolsContentInsetClassNames.compact} pt-2`}>
          <DataSourcePage stickyToolbar />
        </div>
      )
    case 'api-based-extension':
      return (
        <div className={`${toolsContentFrameClassNames.compact} ${toolsContentInsetClassNames.compact} pt-6`}>
          <ApiBasedExtensionPage />
        </div>
      )
    case 'trigger':
      return <PluginCategoryPage canInstall={canInstallPlugin} category={PluginCategoryEnum.trigger} onSwitchToMarketplace={onSwitchToMarketplace} toolbarAction={pluginCategoryToolbarAction} />
    case 'agent-strategy':
      return <PluginCategoryPage canInstall={canInstallPlugin} category={PluginCategoryEnum.agent} onSwitchToMarketplace={onSwitchToMarketplace} toolbarAction={pluginCategoryToolbarAction} />
    case 'extension':
      return <PluginCategoryPage canInstall={canInstallPlugin} category={PluginCategoryEnum.extension} onSwitchToMarketplace={onSwitchToMarketplace} toolbarAction={pluginCategoryToolbarAction} />
    default:
      return null
  }
}

export default IntegrationSectionRenderer
