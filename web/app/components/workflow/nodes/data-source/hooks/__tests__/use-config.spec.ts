import type { DataSourceNodeType } from '../../types'
import { act } from '@testing-library/react'
import { createDatasourceProvider } from '@/app/components/rag-pipeline/__tests__/datasource-fixtures'
import { VarKindType } from '@/app/components/workflow/nodes/_base/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { renderNodeConfig } from '../../../__tests__/render-node-config'
import { useConfig } from '../use-config'

const data: DataSourceNodeType = {
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
  _dataSourceStartToAdd: true,
}
it('persists initialization, extensions and consecutive parameter edits in the datasource graph', () => {
  const { result } = renderNodeConfig(useConfig, data)
  expect(result.current.flow.getNode('node')?.data._dataSourceStartToAdd).toBe(false)
  act(() => result.current.config.handleFileExtensionsChange(['pdf', 'csv']))
  act(() =>
    result.current.config.handleParametersChange({
      count: { type: VarKindType.constant, value: 0 },
    }),
  )
  expect(result.current.flow.getNode('node')?.data).toMatchObject({
    _dataSourceStartToAdd: false,
    fileExtensions: ['pdf', 'csv'],
    datasource_parameters: { count: { type: VarKindType.constant, value: 0 } },
  })
})

it('reads generated datasource output declarations and safely keeps unknown property schemas visible', () => {
  const provider = createDatasourceProvider()
  provider.declaration.datasources![0]!.output_schema = {
    properties: {
      metadata: { type: 'object', properties: { title: { type: 'string' } } },
      names: { type: 'array', items: { type: 'string' }, description: 'Names' },
      missingItems: { type: 'array' },
      unrestricted: true,
      forbidden: false,
      empty: {},
      nullable: null,
    },
  }
  const { result } = renderNodeConfig((id, payload) => useConfig(id, payload, [provider]), data)
  expect(result.current.config.hasObjectOutput).toBe(true)
  expect(result.current.config.outputSchema.map(({ name, type }) => ({ name, type }))).toEqual([
    { name: 'metadata', type: 'object' },
    { name: 'names', type: 'array[string]' },
    { name: 'missingItems', type: 'array[unknown]' },
    { name: 'unrestricted', type: 'unknown' },
    { name: 'forbidden', type: 'unknown' },
    { name: 'empty', type: 'unknown' },
    { name: 'nullable', type: 'unknown' },
  ])
})

it('accepts a datasource without declared outputs', () => {
  const { result } = renderNodeConfig(
    (id, payload) => useConfig(id, payload, [createDatasourceProvider()]),
    data,
  )
  expect(result.current.config.outputSchema).toEqual([])
  expect(result.current.config.hasObjectOutput).toBe(false)
})
