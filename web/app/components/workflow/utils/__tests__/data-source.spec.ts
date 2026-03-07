import type { DataSourceNodeType } from '../../nodes/data-source/types'
import type { ToolWithProvider } from '../../types'
import { CollectionType } from '@/app/components/tools/types'
import { BlockEnum } from '../../types'
import { getDataSourceCheckParams } from '../data-source'

vi.mock('@/app/components/tools/utils/to-form-schema', () => ({
  toolParametersToFormSchemas: vi.fn((params: Array<Record<string, unknown>>) =>
    params.map(p => ({
      variable: p.name,
      label: p.label || { en_US: p.name },
      type: p.type || 'string',
      required: p.required ?? false,
      form: p.form ?? 'llm',
      hide: p.hide ?? false,
    }))),
}))

function createDataSourceData(overrides: Partial<DataSourceNodeType> = {}): DataSourceNodeType {
  return {
    title: 'DataSource',
    desc: '',
    type: BlockEnum.DataSource,
    plugin_id: 'plugin-ds-1',
    provider_type: CollectionType.builtIn,
    datasource_name: 'mysql_query',
    datasource_parameters: {},
    datasource_configurations: {},
    ...overrides,
  } as DataSourceNodeType
}

function createDataSourceCollection(overrides: Partial<ToolWithProvider> = {}): ToolWithProvider {
  return {
    id: 'ds-collection',
    plugin_id: 'plugin-ds-1',
    name: 'MySQL',
    tools: [
      {
        name: 'mysql_query',
        parameters: [
          { name: 'query', label: { en_US: 'SQL Query', zh_Hans: 'SQL 查询' }, type: 'string', required: true },
          { name: 'limit', label: { en_US: 'Limit' }, type: 'number', required: false, hide: true },
        ],
      },
    ],
    allow_delete: true,
    is_authorized: false,
    ...overrides,
  } as unknown as ToolWithProvider
}

describe('getDataSourceCheckParams', () => {
  it('should extract input schema from matching data source', () => {
    const result = getDataSourceCheckParams(
      createDataSourceData(),
      [createDataSourceCollection()],
      'en_US',
    )

    expect(result.dataSourceInputsSchema).toEqual([
      { label: 'SQL Query', variable: 'query', type: 'string', required: true, hide: false },
      { label: 'Limit', variable: 'limit', type: 'number', required: false, hide: true },
    ])
  })

  it('should mark notAuthed for builtin datasource without authorization', () => {
    const result = getDataSourceCheckParams(
      createDataSourceData(),
      [createDataSourceCollection()],
      'en_US',
    )

    expect(result.notAuthed).toBe(true)
  })

  it('should mark as authed when is_authorized is true', () => {
    const result = getDataSourceCheckParams(
      createDataSourceData(),
      [createDataSourceCollection({ is_authorized: true })],
      'en_US',
    )

    expect(result.notAuthed).toBe(false)
  })

  it('should return empty schemas when data source is not found', () => {
    const result = getDataSourceCheckParams(
      createDataSourceData({ plugin_id: 'non-existent' }),
      [createDataSourceCollection()],
      'en_US',
    )

    expect(result.dataSourceInputsSchema).toEqual([])
  })

  it('should return empty schemas when datasource item is not found', () => {
    const result = getDataSourceCheckParams(
      createDataSourceData({ datasource_name: 'non_existent_ds' }),
      [createDataSourceCollection()],
      'en_US',
    )

    expect(result.dataSourceInputsSchema).toEqual([])
  })

  it('should include language in result', () => {
    const result = getDataSourceCheckParams(
      createDataSourceData(),
      [createDataSourceCollection()],
      'zh_Hans',
    )

    expect(result.language).toBe('zh_Hans')
  })
})
