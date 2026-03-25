import type { ListFilterNodeType } from '../types'
import { renderHook } from '@testing-library/react'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { createNodeCrudModuleMock } from '../../__tests__/use-config-test-utils'
import { ComparisonOperator } from '../../if-else/types'
import { OrderBy } from '../types'
import useConfig from '../use-config'

const mockSetInputs = vi.hoisted(() => vi.fn())
const mockGetCurrentVariableType = vi.hoisted(() => vi.fn())

vi.mock('@/app/components/workflow/hooks', () => ({
  useNodesReadOnly: () => ({ nodesReadOnly: false }),
  useIsChatMode: () => false,
  useWorkflow: () => ({
    getBeforeNodesInSameBranch: () => [
      { id: 'start-node', data: { title: 'Start', type: BlockEnum.Start } },
    ],
  }),
  useWorkflowVariables: () => ({
    getCurrentVariableType: (...args: unknown[]) => mockGetCurrentVariableType(...args),
  }),
}))

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-node-crud', () => ({
  ...createNodeCrudModuleMock<ListFilterNodeType>(mockSetInputs),
}))

vi.mock('reactflow', async () => {
  const actual = await vi.importActual<typeof import('reactflow')>('reactflow')
  return {
    ...actual,
    useStoreApi: () => ({
      getState: () => ({
        getNodes: () => [
          { id: 'list-node', parentId: 'iteration-parent' },
          { id: 'iteration-parent', data: { title: 'Iteration', type: BlockEnum.Iteration } },
        ],
      }),
    }),
  }
})

const createPayload = (overrides: Partial<ListFilterNodeType> = {}): ListFilterNodeType => ({
  title: 'List Filter',
  desc: '',
  type: BlockEnum.ListFilter,
  variable: ['node-1', 'items'],
  var_type: VarType.arrayString,
  item_var_type: VarType.string,
  filter_by: {
    enabled: true,
    conditions: [{
      key: '',
      comparison_operator: ComparisonOperator.equal,
      value: '',
    }],
  },
  extract_by: {
    enabled: false,
    serial: '',
  },
  order_by: {
    enabled: false,
    key: '',
    value: OrderBy.DESC,
  },
  limit: {
    enabled: false,
    size: 10,
  },
  ...overrides,
})

describe('useConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetCurrentVariableType.mockReturnValue(VarType.arrayString)
  })

  it('should expose derived variable metadata and filter array-like vars', () => {
    const { result } = renderHook(() => useConfig('list-node', createPayload()))

    expect(result.current.readOnly).toBe(false)
    expect(result.current.varType).toBe(VarType.arrayString)
    expect(result.current.itemVarType).toBe(VarType.string)
    expect(result.current.itemVarTypeShowName).toBe('String')
    expect(result.current.hasSubVariable).toBe(false)
    expect(result.current.filterVar({ type: VarType.arrayBoolean } as never)).toBe(true)
    expect(result.current.filterVar({ type: VarType.object } as never)).toBe(false)
  })

  it('should reset filter conditions when the variable changes to file arrays', () => {
    mockGetCurrentVariableType.mockReturnValue(VarType.arrayFile)
    const payload = createPayload({
      order_by: {
        enabled: true,
        key: '',
        value: OrderBy.DESC,
      },
    })
    const { result } = renderHook(() => useConfig('list-node', payload))

    result.current.handleVarChanges(['node-2', 'files'])

    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      variable: ['node-2', 'files'],
      var_type: VarType.arrayFile,
      item_var_type: VarType.file,
      filter_by: {
        enabled: true,
        conditions: [{
          key: 'name',
          comparison_operator: ComparisonOperator.contains,
          value: '',
        }],
      },
      order_by: expect.objectContaining({
        key: 'name',
      }),
    }))
  })

  it('should update filter, extract, limit and order-by settings', () => {
    const { result } = renderHook(() => useConfig('list-node', createPayload()))

    result.current.handleFilterEnabledChange(false)
    result.current.handleFilterChange({
      key: 'size',
      comparison_operator: ComparisonOperator.largerThan,
      value: 3,
    })
    result.current.handleLimitChange({ enabled: true, size: 5 })
    result.current.handleExtractsEnabledChange(true)
    result.current.handleExtractsChange('2')
    result.current.handleOrderByEnabledChange(true)
    result.current.handleOrderByKeyChange('size')
    result.current.handleOrderByTypeChange(OrderBy.ASC)()

    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      filter_by: expect.objectContaining({ enabled: false }),
    }))
    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      filter_by: expect.objectContaining({
        conditions: [{
          key: 'size',
          comparison_operator: ComparisonOperator.largerThan,
          value: 3,
        }],
      }),
    }))
    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      limit: { enabled: true, size: 5 },
    }))
    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      extract_by: { enabled: true, serial: '1' },
    }))
    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      extract_by: { enabled: false, serial: '2' },
    }))
    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      order_by: expect.objectContaining({
        enabled: true,
        value: OrderBy.ASC,
        key: '',
      }),
    }))
    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      order_by: expect.objectContaining({
        enabled: false,
        key: 'size',
        value: OrderBy.DESC,
      }),
    }))
    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      order_by: expect.objectContaining({
        enabled: false,
        key: '',
        value: OrderBy.ASC,
      }),
    }))
  })
})
