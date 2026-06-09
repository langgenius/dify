import type { DataSourceItem } from '../types'
import { transformDataSourceToTool } from '../utils'

const createLocalizedText = (text: string) => ({
  en_US: text,
  zh_Hans: text,
})

const createDataSourceItem = (overrides: Partial<DataSourceItem> = {}): DataSourceItem => ({
  plugin_id: 'plugin-1',
  plugin_unique_identifier: 'plugin-1@provider',
  provider: 'provider-a',
  declaration: {
    credentials_schema: [{ name: 'api_key' }],
    provider_type: 'hosted',
    identity: {
      author: 'Dify',
      description: createLocalizedText('Datasource provider'),
      icon: 'provider-icon',
      label: createLocalizedText('Provider A'),
      name: 'provider-a',
      tags: ['retrieval', 'storage'],
    },
    datasources: [
      {
        description: createLocalizedText('Search in documents'),
        identity: {
          author: 'Dify',
          label: createLocalizedText('Document Search'),
          name: 'document_search',
          provider: 'provider-a',
        },
        parameters: [{ name: 'query', type: 'string' }],
        output_schema: {
          type: 'object',
          properties: {
            result: { type: 'string' },
          },
        },
      },
    ],
  },
  is_authorized: true,
  ...overrides,
})

describe('transformDataSourceToTool', () => {
  it('should map datasource provider fields to tool shape', () => {
    const dataSourceItem = createDataSourceItem()

    const result = transformDataSourceToTool(dataSourceItem)

    expect(result).toMatchObject({
      id: 'plugin-1',
      provider: 'provider-a',
      name: 'provider-a',
      author: 'Dify',
      description: createLocalizedText('Datasource provider'),
      icon: 'provider-icon',
      label: createLocalizedText('Provider A'),
      type: 'hosted',
      allow_delete: true,
      is_authorized: true,
      is_team_authorization: true,
      labels: ['retrieval', 'storage'],
      plugin_id: 'plugin-1',
      plugin_unique_identifier: 'plugin-1@provider',
      credentialsSchema: [{ name: 'api_key' }],
      meta: { version: '' },
    })
    expect(result.team_credentials).toEqual({})
    expect(result.tools).toEqual([
      {
        name: 'document_search',
        author: 'Dify',
        label: createLocalizedText('Document Search'),
        description: createLocalizedText('Search in documents'),
        parameters: [{ name: 'query', type: 'string' }],
        labels: [],
        output_schema: {
          type: 'object',
          properties: {
            result: { type: 'string' },
          },
        },
      },
    ])
  })

  it('should fallback to empty arrays when tags and credentials schema are missing', () => {
    const baseDataSourceItem = createDataSourceItem()
    const dataSourceItem = createDataSourceItem({
      declaration: {
        ...baseDataSourceItem.declaration,
        credentials_schema: undefined as unknown as DataSourceItem['declaration']['credentials_schema'],
        identity: {
          ...baseDataSourceItem.declaration.identity,
          tags: undefined as unknown as DataSourceItem['declaration']['identity']['tags'],
        },
      },
    })

    const result = transformDataSourceToTool(dataSourceItem)

    expect(result.labels).toEqual([])
    expect(result.credentialsSchema).toEqual([])
  })
})
