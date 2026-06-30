'use client'

import type { ReactNode } from 'react'
import type { IntegrationSection } from './routes'
import { ApiBasedExtensionPage } from '@/app/components/header/account-setting/api-based-extension-page'
import DataSourcePage from '@/app/components/header/account-setting/data-source-page-new'
import ModelProviderPage from '@/app/components/header/account-setting/model-provider-page'
import InstallFromMarketplaceQuery from '@/app/components/plugins/install-plugin/install-from-marketplace-query'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { toolsContentFrameClassNames, toolsContentInsetClassNames } from '@/app/components/tools/content-inset'
import { IntegrationPageHeader } from './page-header'
import PluginCategoryPage from './plugin-category-page'
import { IntegrationSectionLayout } from './section-layout'
import ToolProviderList from './tool-provider-list'

type IntegrationSectionRendererProps = {
  canInstallPlugin?: boolean
  canDeletePlugin?: boolean
  isInstallPermissionLoading?: boolean
  canUpdatePlugin?: boolean
  description?: ReactNode
  onProviderSearchTextChange: (value: string) => void
  onSwitchToMarketplace?: () => void
  pluginCategoryToolbarAction?: ReactNode
  providerSearchText: string
  scrollAreaLabel?: string
  section: IntegrationSection
  title?: ReactNode
}

const IntegrationSectionRenderer = ({
  canInstallPlugin = true,
  canDeletePlugin = true,
  isInstallPermissionLoading = false,
  canUpdatePlugin = true,
  description,
  onProviderSearchTextChange,
  onSwitchToMarketplace,
  pluginCategoryToolbarAction,
  providerSearchText,
  scrollAreaLabel,
  section,
  title,
}: IntegrationSectionRendererProps) => {
  const compactFrameClassName = `${toolsContentFrameClassNames.compact} ${toolsContentInsetClassNames.compact}`
  const renderHeader = (toolbar?: ReactNode) => (
    <IntegrationPageHeader
      align="start"
      title={title}
      description={description}
      descriptionClassName="system-xs-regular"
      frameClassName={compactFrameClassName}
      toolbar={toolbar}
    />
  )
  const renderScrollBody = (body: ReactNode) => (
    <IntegrationSectionLayout
      label={scrollAreaLabel}
      bodyClassName={`${compactFrameClassName} pt-1`}
    >
      {body}
    </IntegrationSectionLayout>
  )
  const renderScrollableLayout = ({ body, toolbar }: { body: ReactNode, toolbar: ReactNode }) => (
    <>
      {renderHeader(toolbar)}
      {renderScrollBody(body)}
    </>
  )
  const renderDirectLayout = ({ body, toolbar }: { body: ReactNode, toolbar: ReactNode }) => (
    <>
      {renderHeader(toolbar)}
      {body}
    </>
  )
  const renderPluginCategoryPage = (category: PluginCategoryEnum) => (
    <PluginCategoryPage
      canInstall={canInstallPlugin}
      canDeletePlugin={canDeletePlugin}
      isInstallPermissionLoading={isInstallPermissionLoading}
      canUpdatePlugin={canUpdatePlugin}
      category={category}
      layout={renderDirectLayout}
      onSwitchToMarketplace={onSwitchToMarketplace}
      toolbarAction={pluginCategoryToolbarAction}
    />
  )
  const renderMarketplaceInstallQuery = (category: PluginCategoryEnum) => (
    <InstallFromMarketplaceQuery
      canInstallPlugin={canInstallPlugin}
      isPermissionLoading={isInstallPermissionLoading}
      installContextCategory={category}
    />
  )

  switch (section) {
    case 'provider':
      return (
        <>
          <ModelProviderPage
            hideSystemModelSelectorProviderSettingsFooter
            layout={renderScrollableLayout}
            onOpenMarketplace={onSwitchToMarketplace}
            searchText={providerSearchText}
            stickyToolbar
            onSearchTextChange={onProviderSearchTextChange}
          />
          {renderMarketplaceInstallQuery(PluginCategoryEnum.model)}
        </>
      )
    case 'builtin':
      return renderPluginCategoryPage(PluginCategoryEnum.tool)
    case 'mcp':
      return <ToolProviderList category="mcp" contentInset="compact" layout={renderDirectLayout} />
    case 'custom-tool':
      return <ToolProviderList category="api" contentInset="compact" layout={renderDirectLayout} />
    case 'workflow-tool':
      return <ToolProviderList category="workflow" contentInset="compact" layout={renderDirectLayout} />
    case 'data-source':
      return (
        <>
          <DataSourcePage stickyToolbar layout={renderScrollableLayout} onOpenMarketplace={onSwitchToMarketplace} />
          {renderMarketplaceInstallQuery(PluginCategoryEnum.datasource)}
        </>
      )
    case 'custom-endpoint':
      return <ApiBasedExtensionPage layout={renderScrollableLayout} />
    case 'trigger':
      return renderPluginCategoryPage(PluginCategoryEnum.trigger)
    case 'agent-strategy':
      return renderPluginCategoryPage(PluginCategoryEnum.agent)
    case 'extension':
      return renderPluginCategoryPage(PluginCategoryEnum.extension)
    default:
      return null
  }
}

export default IntegrationSectionRenderer
