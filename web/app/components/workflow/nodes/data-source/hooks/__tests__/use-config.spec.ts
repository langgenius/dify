import type { DataSourceNodeType } from '../../types'
import { renderHook } from '@testing-library/react'
import { VarType as VarKindType } from '../../types'
import { useConfig } from '../use-config'

const mockUseStoreApi = vi.hoisted(() => vi.fn())
const mockUseNodeDataUpdate = vi.hoisted(() => vi.fn())

vi.mock('reactflow', () => ({
  useStoreApi: () => mockUseStoreApi(),
}))

vi.mock('@/app/components/workflow/hooks', () => ({
  useNodeDataUpdate: () => mockUseNodeDataUpdate(),
}))

const createNode = (overrides: Partial<DataSourceNodeType> = {}): { id: string, data: DataSourceNodeType } => ({
  id: 'data-source-node',
  data: {
    title: 'Datasource',
    desc: '',
    type: 'data-source',
    plugin_id: 'plugin-1',
    provider_type: 'local_file',
    provider_name: 'provider',
    datasource_name: 'source-a',
    datasource_label: 'Source A',
    datasource_parameters: {},
    datasource_configurations: {},
    _dataSourceStartToAdd: true,
    ...overrides,
  } as DataSourceNodeType,
})

describe('data-source/hooks/use-config', () => {
  const mockHandleNodeDataUpdateWithSyncDraft = vi.fn()
  let currentNode = createNode()

  beforeEach(() => {
    vi.clearAllMocks()
    currentNode = createNode()

    mockUseStoreApi.mockReturnValue({
      getState: () => ({
        getNodes: () => [currentNode],
      }),
    })
    mockUseNodeDataUpdate.mockReturnValue({
      handleNodeDataUpdateWithSyncDraft: mockHandleNodeDataUpdateWithSyncDraft,
    })
  })

  it('should clear the local-file auto-add flag on mount and update datasource payloads', () => {
    const { result } = renderHook(() => useConfig('data-source-node'))

    expect(mockHandleNodeDataUpdateWithSyncDraft).toHaveBeenCalledWith({
      id: 'data-source-node',
      data: expect.objectContaining({
        _dataSourceStartToAdd: false,
      }),
    })

    mockHandleNodeDataUpdateWithSyncDraft.mockClear()
    result.current.handleFileExtensionsChange(['pdf', 'csv'])
    result.current.handleParametersChange({
      dataset: {
        type: VarKindType.constant,
        value: 'docs',
      },
    })

    expect(mockHandleNodeDataUpdateWithSyncDraft).toHaveBeenNthCalledWith(1, {
      id: 'data-source-node',
      data: expect.objectContaining({
        fileExtensions: ['pdf', 'csv'],
      }),
    })
    expect(mockHandleNodeDataUpdateWithSyncDraft).toHaveBeenNthCalledWith(2, {
      id: 'data-source-node',
      data: expect.objectContaining({
        datasource_parameters: {
          dataset: {
            type: VarKindType.constant,
            value: 'docs',
          },
        },
      }),
    })
  })

  it('should derive output schema metadata and detect object outputs', () => {
    const dataSourceList = [{
      plugin_id: 'plugin-1',
      tools: [{
        name: 'source-a',
        output_schema: {
          properties: {
            items: {
              type: 'array',
              items: { type: 'string' },
              description: 'List of items',
            },
            metadata: {
              type: 'object',
              description: 'Object field',
            },
            count: {
              type: 'number',
              description: 'Total count',
            },
          },
        },
      }],
    }]

    const { result } = renderHook(() => useConfig('data-source-node', dataSourceList))

    expect(result.current.outputSchema).toEqual([
      {
        name: 'items',
        type: 'Array[String]',
        description: 'List of items',
      },
      {
        name: 'metadata',
        value: {
          type: 'object',
          description: 'Object field',
        },
      },
      {
        name: 'count',
        type: 'Number',
        description: 'Total count',
      },
    ])
    expect(result.current.hasObjectOutput).toBe(true)
  })
})
