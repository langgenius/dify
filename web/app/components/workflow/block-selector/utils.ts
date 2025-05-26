import type { Tool } from '@/app/components/tools/types'
import type { DataSourceItem } from './types'

export const transformDataSourceToTool = (dataSourceItem: DataSourceItem) => {
  return {
    id: dataSourceItem.plugin_id,
    name: dataSourceItem.declaration.identity.name,
    author: dataSourceItem.declaration.identity.author,
    description: dataSourceItem.declaration.identity.description,
    icon: dataSourceItem.declaration.identity.icon,
    label: dataSourceItem.declaration.identity.label,
    type: dataSourceItem.declaration.provider_type,
    team_credentials: {},
    is_team_authorization: false,
    allow_delete: true,
    labels: dataSourceItem.declaration.identity.tags || [],
    plugin_id: dataSourceItem.plugin_id,
    tools: dataSourceItem.declaration.datasources.map((datasource) => {
      return {
        name: datasource.identity.name,
        author: datasource.identity.author,
        label: datasource.identity.label,
        description: datasource.description,
        parameters: datasource.parameters,
        labels: [],
        output_schema: {},
      } as Tool
    }),
  }
}
