import type { DataSourceNodeType } from '../../types'
import { act } from '@testing-library/react'
import { createDatasourceProvider } from '@/app/components/rag-pipeline/__tests__/datasource-fixtures'
import { renderWorkflowFlowHook } from '@/app/components/workflow/__tests__/workflow-test-env'
import { VarKindType } from '@/app/components/workflow/nodes/_base/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { useConfig } from '../use-config'

const { update } = vi.hoisted(() => ({ update: vi.fn() }))
vi.mock('../../../../hooks/use-node-data-update', () => ({
  useNodeDataUpdate: () => ({ handleNodeDataUpdateWithSyncDraft: update }),
}))
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
const nodes = [{ id: 'datasource', position: { x: 0, y: 0 }, data }]
beforeEach(() => vi.clearAllMocks())

it('clears local-file initialization and saves parameters and extensions through the draft owner', () => {
  const { result } = renderWorkflowFlowHook(() => useConfig('datasource', data), { nodes })
  expect(update).toHaveBeenCalledWith({
    id: 'datasource',
    data: { ...data, _dataSourceStartToAdd: false },
  })
  act(() => result.current.handleFileExtensionsChange(['pdf', 'csv']))
  expect(update).toHaveBeenLastCalledWith({
    id: 'datasource',
    data: { ...data, fileExtensions: ['pdf', 'csv'] },
  })
  act(() =>
    result.current.handleParametersChange({ count: { type: VarKindType.constant, value: 0 } }),
  )
  expect(update).toHaveBeenLastCalledWith({
    id: 'datasource',
    data: { ...data, datasource_parameters: { count: { type: VarKindType.constant, value: 0 } } },
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
  const { result } = renderWorkflowFlowHook(() => useConfig('datasource', data, [provider]), {
    nodes,
  })
  expect(result.current.hasObjectOutput).toBe(true)
  expect(result.current.outputSchema.map(({ name, type }) => ({ name, type }))).toEqual([
    { name: 'metadata', type: 'object' },
    { name: 'names', type: 'array[string]' },
    { name: 'missingItems', type: 'array[unknown]' },
    { name: 'unrestricted', type: 'unknown' },
    { name: 'forbidden', type: 'unknown' },
    { name: 'empty', type: 'unknown' },
    { name: 'nullable', type: 'unknown' },
  ])
})

it('accepts null output schemas and absent catalog data', () => {
  const { result } = renderWorkflowFlowHook(
    () => useConfig('datasource', data, [createDatasourceProvider()]),
    { nodes },
  )
  expect(result.current.outputSchema).toEqual([])
  expect(result.current.hasObjectOutput).toBe(false)
})
