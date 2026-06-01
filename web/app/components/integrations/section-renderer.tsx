'use client'

import type { ReactNode } from 'react'
import type { IntegrationSection } from './routes'
import { ApiBasedExtensionPage } from '@/app/components/header/account-setting/api-based-extension-page'
import DataSourcePage from '@/app/components/header/account-setting/data-source-page-new'
import ModelProviderPage from '@/app/components/header/account-setting/model-provider-page'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { toolsContentFrameClassNames, toolsContentInsetClassNames } from '@/app/components/tools/content-inset'
import PluginCategoryPage from './plugin-category-page'
import { IntegrationSectionLayout } from './section-layout'
import ToolProviderList from './tool-provider-list'

type IntegrationSectionRendererProps = {
  canInstallPlugin?: boolean
  onProviderSearchTextChange: (value: string) => void
  onSwitchToMarketplace?: () => void
  pluginCategoryToolbarAction?: ReactNode
  providerSearchText: string
  scrollAreaLabel?: string
  section: IntegrationSection
}

const IntegrationSectionRenderer = ({
  canInstallPlugin = true,
  onProviderSearchTextChange,
  onSwitchToMarketplace,
  pluginCategoryToolbarAction,
  providerSearchText,
  scrollAreaLabel,
  section,
}: IntegrationSectionRendererProps) => {
  const compactFrameClassName = `${toolsContentFrameClassNames.compact} ${toolsContentInsetClassNames.compact}`
  const renderCompactLayout = ({ body, toolbar }: { body: ReactNode, toolbar: ReactNode }) => (
    <IntegrationSectionLayout
      label={scrollAreaLabel}
      toolbar={toolbar}
      toolbarClassName={`${compactFrameClassName} pt-2`}
      bodyClassName={compactFrameClassName}
    >
      {body}
    </IntegrationSectionLayout>
  )

  switch (section) {
    case 'provider':
      return (
        <ModelProviderPage
          fixedWarningAlignment="content-frame"
          hideSystemModelSelectorProviderSettingsFooter
          layout={renderCompactLayout}
          searchText={providerSearchText}
          stickyToolbar
          onSearchTextChange={onProviderSearchTextChange}
        />
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
        <DataSourcePage stickyToolbar layout={renderCompactLayout} />
      )
    case 'custom-endpoint':
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
