import type { DataSourceItem } from './types'
import type { Tool } from '@/app/components/tools/types'
import { pinyin } from 'pinyin-pro'

export const transformDataSourceToTool = (dataSourceItem: DataSourceItem) => {
  return {
    id: dataSourceItem.plugin_id,
    provider: dataSourceItem.provider,
    name: dataSourceItem.provider,
    author: dataSourceItem.declaration.identity.author,
    description: dataSourceItem.declaration.identity.description,
    icon: dataSourceItem.declaration.identity.icon,
    label: dataSourceItem.declaration.identity.label,
    type: dataSourceItem.declaration.provider_type,
    team_credentials: {},
    allow_delete: true,
    is_team_authorization: dataSourceItem.is_authorized,
    is_authorized: dataSourceItem.is_authorized,
    labels: dataSourceItem.declaration.identity.tags || [],
    plugin_id: dataSourceItem.plugin_id,
    plugin_unique_identifier: dataSourceItem.plugin_unique_identifier,
    tools: dataSourceItem.declaration.datasources.map((datasource) => {
      return {
        name: datasource.identity.name,
        author: datasource.identity.author,
        label: datasource.identity.label,
        description: datasource.description,
        parameters: datasource.parameters,
        labels: [],
        output_schema: datasource.output_schema,
      } as Tool
    }),
    credentialsSchema: dataSourceItem.declaration.credentials_schema || [],
    meta: {
      version: '',
    },
  }
}

export function getProviderLetter(firstChar: string) {
  const pinyinInitial = /[\u4E00-\u9FA5]/.test(firstChar)
    ? pinyin(firstChar, { pattern: 'first', toneType: 'none' })[0]
    : firstChar
  const letter = (pinyinInitial || firstChar).toUpperCase()

  return /[A-Z]/.test(letter) ? letter : '#'
}

export function compareProviderLetters(left: string, right: string) {
  if (left === right) return 0
  if (left === '#') return 1
  if (right === '#') return -1
  return left.localeCompare(right)
}
