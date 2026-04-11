import type { ListFilterNodeType } from '../types'
import { renderHook } from '@testing-library/react'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { createNodeCrudModuleMock } from '../../__tests__/use-config-test-utils'
import { ComparisonOperator } from '../../if-else/types'
import { OrderBy } from '../types'
import useConfig from '../use-config'

const mockSetInputs = vi.hoisted(() => vi.fn())
const mockGetNodes = vi.hoisted(() => vi.fn())
const mockGetBeforeNodesInSameBranch = vi.hoisted(() => vi.fn())
const mockGetCurrentVariableType = vi.hoisted(() => vi.fn())

let mockNodesReadOnly = false
let mockIsChatMode = false

vi.mock('reactflow', async () => {
  const actual = await vi.importActual<typeof import('reactflow')>('reactflow')
  return {
    ...actual,
    useStoreApi: () => ({
      getState: () => ({
        getNodes: mockGetNodes,
      }),
    }),
  }
})

vi.mock('@/app/components/workflow/hooks', () => ({
  useNodesReadOnly: () => ({ nodesReadOnly: mockNodesReadOnly }),
  useIsChatMode: () => mockIsChatMode,
  useWorkflow: () => ({
    getBeforeNodesInSameBranch: (...args: unknown[]) => mockGetBeforeNodesInSameBranch(...args),
  }),
  useWorkflowVariables: () => ({
    getCurrentVariableType: (...args: unknown[]) => mockGetCurrentVariableType(...args),
  }),
}))

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-node-crud', () => ({
  ...createNodeCrudModuleMock<ListFilterNodeType>(mockSetInputs),
}))

const createPayload = (overrides: Partial<ListFilterNodeType> = {}): ListFilterNodeType => ({
  title: 'List Filter',
  desc: '',
  type: BlockEnum.ListFilter,
  variable: ['start', 'files'],
  var_type: VarType.arrayFile,
  item_var_type: VarType.file,
  filter_by: {
    enabled: false,
    conditions: [{
      key: '',
      comparison_operator: ComparisonOperator.contains,
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
  beforeEach(() => {
    vi.clearAllMocks()
    mockNodesReadOnly = false
    mockIsChatMode = false
    mockGetBeforeNodesInSameBranch.mockReturnValue([{ id: 'before-node' }])
    mockGetNodes.mockReturnValue([{ id: 'list-node' }])
    mockGetCurrentVariableType.mockImplementation(({ valueSelector }: { valueSelector: string[] }) => {
      if (valueSelector[1] === 'files')
        return VarType.arrayFile
      if (valueSelector[1] === 'numbers')
        return VarType.arrayNumber
      return VarType.arrayString
    })
  })

  it('should expose derived state and update inputs through the helper pipeline', () => {
    const { result } = renderHook(() => useConfig('list-node', createPayload()))

    expect(result.current.readOnly).toBe(false)
    expect(result.current.varType).toBe(VarType.arrayFile)
    expect(result.current.itemVarType).toBe(VarType.file)
    expect(result.current.itemVarTypeShowName).toBe('File')
    expect(result.current.hasSubVariable).toBe(true)
    expect(result.current.filterVar({ type: VarType.arrayString } as never)).toBe(true)
    expect(result.current.filterVar({ type: VarType.object } as never)).toBe(false)

    result.current.handleVarChanges(['node-2', 'numbers'])
    result.current.handleFilterEnabledChange(true)
    result.current.handleFilterChange({
      key: 'size',
      comparison_operator: ComparisonOperator.largerThan,
      value: '2',
    })
    result.current.handleLimitChange({ enabled: true, size: 3 })
    result.current.handleExtractsEnabledChange(true)
    result.current.handleExtractsChange('5')
    result.current.handleOrderByEnabledChange(true)
    result.current.handleOrderByKeyChange('size')
    result.current.handleOrderByTypeChange(OrderBy.DESC)()

    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      variable: ['node-2', 'numbers'],
      var_type: VarType.arrayNumber,
      item_var_type: VarType.number,
    }))
    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      filter_by: expect.objectContaining({
        enabled: true,
      }),
    }))
    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      filter_by: expect.objectContaining({
        conditions: [{
          key: 'size',
          comparison_operator: ComparisonOperator.largerThan,
          value: '2',
        }],
      }),
    }))
    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      limit: { enabled: true, size: 3 },
    }))
    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      extract_by: { enabled: true, serial: '1' },
    }))
    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      extract_by: { enabled: false, serial: '5' },
    }))
    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      order_by: expect.objectContaining({
        enabled: true,
        key: 'name',
        value: OrderBy.ASC,
      }),
    }))
    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      order_by: expect.objectContaining({
        key: 'size',
      }),
    }))
    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      order_by: expect.objectContaining({
        value: OrderBy.DESC,
      }),
    }))
  })

  it('should derive parent nodes from iteration and loop contexts', () => {
    mockNodesReadOnly = true
    mockIsChatMode = true
    mockGetNodes.mockReturnValue([
      { id: 'list-node', parentId: 'iteration-parent' },
      { id: 'iteration-parent' },
      { id: 'loop-node', parentId: 'loop-parent' },
      { id: 'loop-parent' },
    ])

    const { result: iterationResult } = renderHook(() => useConfig('list-node', createPayload({
      isInIteration: true,
      variable: ['iteration', 'files'],
    })))
    const { result: loopResult } = renderHook(() => useConfig('loop-node', createPayload({
      isInLoop: true,
      isInIteration: false,
      variable: ['loop', 'names'],
    })))

    iterationResult.current.handleVarChanges(['iteration', 'files'])
    loopResult.current.handleOrderByEnabledChange(true)

    expect(iterationResult.current.readOnly).toBe(true)
    expect(mockGetCurrentVariableType).toHaveBeenCalledWith(expect.objectContaining({
      parentNode: expect.objectContaining({ id: 'iteration-parent' }),
      isChatMode: true,
    }))
    expect(mockGetCurrentVariableType).toHaveBeenCalledWith(expect.objectContaining({
      parentNode: expect.objectContaining({ id: 'loop-parent' }),
      valueSelector: ['loop', 'names'],
    }))
    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      order_by: expect.objectContaining({
        enabled: true,
        key: '',
      }),
    }))
  })
})
