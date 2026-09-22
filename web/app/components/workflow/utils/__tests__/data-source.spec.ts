import type { DatasourceParameter } from '@dify/contracts/api/console/rag/types.gen'
import type { DataSourceNodeType } from '../../nodes/data-source/types'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { createDatasourceProvider } from '@/app/components/rag-pipeline/__tests__/datasource-fixtures'
import { BlockEnum } from '../../types'
import { datasourceParametersToFormSchemas, getDataSourceCheckParams } from '../data-source'

const node: DataSourceNodeType = {
  title: 'Datasource',
  desc: '',
  type: BlockEnum.DataSource,
  plugin_id: 'langgenius/file',
  provider_type: 'local_file',
  provider_name: 'file',
  datasource_name: 'local-file',
  datasource_label: 'File',
  datasource_parameters: {},
  datasource_configurations: {},
}
const parameter = (
  type: DatasourceParameter['type'],
  defaultValue: DatasourceParameter['default'],
) =>
  ({
    name: type,
    type,
    default: defaultValue,
    label: { en_US: 'Parameter', zh_Hans: null },
    description: { en_US: 'Actual datasource description', ja_JP: null },
    required: true,
  }) satisfies DatasourceParameter

it('projects datasource descriptions, nullable locale fallbacks, and exact default values at the form boundary', () => {
  const schemas = datasourceParametersToFormSchemas([
    { ...parameter('number', 0), min: 0, max: 10, placeholder: { en_US: 'Count', zh_Hans: null } },
    parameter('boolean', false),
    parameter('string', ''),
    parameter('secret-input', null),
    {
      ...parameter('select', 'one'),
      options: [{ value: 'one', label: { en_US: 'One', zh_Hans: null }, icon: null }],
    },
    parameter('system-files', []),
  ])
  expect(schemas.map((schema) => schema.default)).toEqual([0, false, '', null, 'one', []])
  expect(schemas[0]).toMatchObject({
    type: FormTypeEnum.textNumber,
    min: 0,
    max: 10,
    tooltip: { en_US: 'Actual datasource description', ja_JP: 'Actual datasource description' },
    label: { zh_Hans: 'Parameter' },
    placeholder: { zh_Hans: 'Count' },
  })
  expect(schemas[1]).toMatchObject({ type: FormTypeEnum.checkbox, _type: FormTypeEnum.boolean })
  expect(schemas[4]?.options?.[0]).toMatchObject({ value: 'one', label: { zh_Hans: 'One' } })
  expect(schemas[5]?.type).toBe(FormTypeEnum.files)
})

it('derives only required-input metadata and keeps local-file authorization independent', () => {
  const provider = createDatasourceProvider({ is_authorized: false })
  provider.declaration.datasources![0]!.parameters = [parameter('string', '')]
  expect(getDataSourceCheckParams(node, [provider], 'zh_Hans')).toEqual({
    dataSourceInputsSchema: [{ label: 'Parameter', variable: 'string', required: true }],
    notAuthed: false,
    language: 'zh_Hans',
  })
  expect(
    getDataSourceCheckParams({ ...node, provider_type: 'online_document' }, [provider], 'en_US')
      .notAuthed,
  ).toBe(true)
  expect(
    getDataSourceCheckParams({ ...node, provider_type: 'online_document' }, [], 'en_US').notAuthed,
  ).toBe(false)
})

it('finds a saved provider without version metadata and leaves missing datasource parameters empty', () => {
  const provider = createDatasourceProvider()
  expect(
    getDataSourceCheckParams(
      { ...node, plugin_id: '', provider_name: provider.provider },
      [provider],
      'en_US',
    ).notAuthed,
  ).toBe(false)
  expect(
    getDataSourceCheckParams({ ...node, datasource_name: 'missing' }, [provider], 'en_US')
      .dataSourceInputsSchema,
  ).toEqual([])
})

it('uses the saved plugin authorization and parameter schema when providers share a name', () => {
  const official = createDatasourceProvider({ is_authorized: true })
  official.declaration.datasources![0]!.parameters = [
    { ...parameter('string', ''), name: 'official_input' },
  ]
  const fork = createDatasourceProvider({
    plugin_id: 'acme/file',
    plugin_unique_identifier: 'acme/file:1.0.0',
    is_authorized: false,
  })
  fork.declaration.datasources![0]!.parameters = [
    { ...parameter('string', ''), name: 'fork_input' },
  ]
  const result = getDataSourceCheckParams(
    { ...node, provider_type: 'online_document' },
    [fork, official],
    'en_US',
  )
  expect(result.notAuthed).toBe(false)
  expect(result.dataSourceInputsSchema).toEqual([
    { label: 'Parameter', variable: 'official_input', required: true },
  ])
})
