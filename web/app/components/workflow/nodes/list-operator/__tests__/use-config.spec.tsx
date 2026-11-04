import type { ListFilterNodeType } from '../types'
import { act } from '@testing-library/react'
import { BlockEnum, InputVarType, VarType } from '@/app/components/workflow/types'
import { createEdge, createNode } from '../../../__tests__/fixtures'
import { renderNodeConfig } from '../../__tests__/render-node-config'
import { ComparisonOperator } from '../../if-else/types'
import { OrderBy } from '../types'
import useConfig from '../use-config'
const createPayload = (overrides: Partial<ListFilterNodeType> = {}): ListFilterNodeType => ({
  title: 'List Filter',
  desc: '',
  type: BlockEnum.ListFilter,
  variable: ['start', 'files'],
  var_type: VarType.arrayFile,
  item_var_type: VarType.file,
  filter_by: {
    enabled: false,
    conditions: [
      {
        key: '',
        comparison_operator: ComparisonOperator.contains,
        value: '',
      },
    ],
  },
  extract_by: {
    enabled: false,
    serial: '',
  },
  order_by: {
    enabled: false,
    key: '',
    value: OrderBy.ASC,
  },
  limit: {
    enabled: false,
    size: 10,
  },
  isInIteration: false,
  isInLoop: false,
  ...overrides,
})

describe('list-operator/use-config', () => {
  it('derives file types from the graph and preserves the complete filter, extraction and ordering config', () => {
    const payload = createPayload()
    const source = createNode({
      id: 'start',
      data: {
        type: BlockEnum.Start,
        variables: [
          { variable: 'files', label: 'Files', type: InputVarType.multiFiles, required: false },
        ],
      },
    })
    const { result } = renderNodeConfig(useConfig, payload, {
      nodes: [source, createNode({ id: 'node', data: payload })],
      edges: [createEdge({ source: 'start', target: 'node' })],
    })
    expect(result.current.config.varType).toBe(VarType.arrayFile)
    expect(result.current.config.itemVarType).toBe(VarType.file)
    expect(result.current.config.hasSubVariable).toBe(true)
    act(() => result.current.config.handleFilterEnabledChange(true))
    const condition = {
      key: 'size',
      comparison_operator: ComparisonOperator.largerThan,
      value: '2',
    }
    act(() => result.current.config.handleFilterChange(condition))
    act(() => result.current.config.handleLimitChange({ enabled: true, size: 3 }))
    act(() => result.current.config.handleExtractsEnabledChange(true))
    act(() => result.current.config.handleExtractsChange('5'))
    act(() => result.current.config.handleOrderByEnabledChange(true))
    act(() => result.current.config.handleOrderByKeyChange('size'))
    act(() => result.current.config.handleOrderByTypeChange(OrderBy.DESC)())
    expect(result.current.flow.getNode('node')?.data).toMatchObject({
      filter_by: { enabled: true, conditions: [condition] },
      limit: { enabled: true, size: 3 },
      extract_by: { enabled: true, serial: '5' },
      order_by: { enabled: true, key: 'size', value: OrderBy.DESC },
    })
  })
  it('derives numeric item types after changing the selected list', () => {
    const payload = createPayload({ order_by: { enabled: true, key: 'size', value: OrderBy.ASC } })
    const source = createNode({
      id: 'source',
      data: {
        type: BlockEnum.Code,
        outputs: { numbers: { type: VarType.arrayNumber, children: null } },
      },
    })
    const { result } = renderNodeConfig(useConfig, payload, {
      nodes: [source, createNode({ id: 'node', data: payload })],
      edges: [createEdge({ source: 'source', target: 'node' })],
    })
    act(() => result.current.config.handleVarChanges(['source', 'numbers']))
    expect(result.current.flow.getNode('node')?.data).toMatchObject({
      variable: ['source', 'numbers'],
      var_type: VarType.arrayNumber,
      item_var_type: VarType.number,
    })
    expect(result.current.config.hasSubVariable).toBe(false)
  })
})
