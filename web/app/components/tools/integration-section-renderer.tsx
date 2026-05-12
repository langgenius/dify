'use client'

import type { IntegrationSection } from './integration-routes'
import ApiBasedExtensionPage from '@/app/components/header/account-setting/api-based-extension-page'
import DataSourcePage from '@/app/components/header/account-setting/data-source-page-new'
import ModelProviderPage from '@/app/components/header/account-setting/model-provider-page'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import PluginCategoryPage from './plugin-category-page'
import ToolProviderList from './provider-list'

type IntegrationSectionRendererProps = {
  providerSearchText: string
  section: IntegrationSection
}

const IntegrationSectionRenderer = ({
  providerSearchText,
  section,
}: IntegrationSectionRendererProps) => {
  switch (section) {
    case 'provider':
      return (
        <div className="px-6 pt-6">
          <ModelProviderPage searchText={providerSearchText} />
        </div>
      )
    case 'builtin':
      return <ToolProviderList category="builtin" />
    case 'mcp':
      return <ToolProviderList category="mcp" />
    case 'custom-tool':
      return <ToolProviderList category="api" />
    case 'workflow-tool':
      return <ToolProviderList category="workflow" />
    case 'data-source':
      return (
        <div className="px-6 pt-6">
          <DataSourcePage />
        </div>
      )
    case 'api-based-extension':
      return (
        <div className="px-6 pt-6">
          <ApiBasedExtensionPage />
        </div>
      )
    case 'trigger':
      return <PluginCategoryPage category={PluginCategoryEnum.trigger} />
    case 'agent-strategy':
      return <PluginCategoryPage category={PluginCategoryEnum.agent} />
    case 'extension':
      return <PluginCategoryPage category={PluginCategoryEnum.extension} />
    default:
      return null
  }
}

export default IntegrationSectionRenderer
