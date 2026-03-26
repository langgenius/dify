import type { AssignerNodeOperation, AssignerNodeType } from '../types'
import { renderHook } from '@testing-library/react'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { createNodeCrudModuleMock } from '../../__tests__/use-config-test-utils'
import { AssignerNodeInputType, WriteMode, writeModeTypesNum } from '../types'
import useConfig from '../use-config'

const mockSetInputs = vi.hoisted(() => vi.fn())
const mockGetAvailableVars = vi.hoisted(() => vi.fn())
const mockGetCurrentVariableType = vi.hoisted(() => vi.fn())

vi.mock('@/app/components/workflow/hooks', () => ({
  useNodesReadOnly: () => ({ nodesReadOnly: false }),
  useIsChatMode: () => false,
  useWorkflow: () => ({
    getBeforeNodesInSameBranchIncludeParent: () => [
      { id: 'start-node', data: { title: 'Start', type: BlockEnum.Start } },
    ],
  }),
  useWorkflowVariables: () => ({
    getCurrentVariableType: (...args: unknown[]) => mockGetCurrentVariableType(...args),
  }),
}))

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-node-crud', () => ({
  ...createNodeCrudModuleMock<AssignerNodeType>(mockSetInputs),
}))

vi.mock('../hooks', () => ({
  useGetAvailableVars: () => mockGetAvailableVars,
}))

vi.mock('reactflow', async () => {
  const actual = await vi.importActual<typeof import('reactflow')>('reactflow')
  return {
    ...actual,
    useStoreApi: () => ({
      getState: () => ({
        getNodes: () => [
          { id: 'assigner-node', parentId: 'iteration-parent' },
          { id: 'iteration-parent', data: { title: 'Iteration', type: BlockEnum.Iteration } },
        ],
      }),
    }),
  }
})

const createOperation = (overrides: Partial<AssignerNodeOperation> = {}): AssignerNodeOperation => ({
  variable_selector: ['conversation', 'count'],
  input_type: AssignerNodeInputType.variable,
  operation: WriteMode.overwrite,
  value: ['node-2', 'result'],
  ...overrides,
})

const createPayload = (overrides: Partial<AssignerNodeType> = {}): AssignerNodeType => ({
  title: 'Assigner',
  desc: '',
  type: BlockEnum.Assigner,
  version: '1',
  items: [createOperation()],
  ...overrides,
})

describe('useConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetCurrentVariableType.mockReturnValue(VarType.arrayString)
    mockGetAvailableVars.mockReturnValue([])
  })

  it('should normalize legacy payloads, expose write mode groups and derive assigned variable types', () => {
    const { result } = renderHook(() => useConfig('assigner-node', createPayload()))

    expect(result.current.readOnly).toBe(false)
    expect(result.current.writeModeTypes).toEqual([WriteMode.overwrite, WriteMode.clear, WriteMode.set])
    expect(result.current.writeModeTypesNum).toEqual(writeModeTypesNum)
    expect(result.current.getAssignedVarType(['conversation', 'count'])).toBe(VarType.arrayString)
    expect(result.current.getToAssignedVarType(VarType.arrayString, WriteMode.append)).toBe(VarType.string)
    expect(result.current.filterVar(VarType.string)({ type: VarType.any } as never)).toBe(true)
  })

  it('should update operation lists with version 2 payloads and apply assignment filters', () => {
    const { result } = renderHook(() => useConfig('assigner-node', createPayload()))
    const nextItems = [createOperation({ operation: WriteMode.append })]

    result.current.handleOperationListChanges(nextItems)

    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      version: '2',
      items: nextItems,
    }))
    expect(result.current.filterAssignedVar({ isLoopVariable: true } as never, ['node', 'value'])).toBe(true)
    expect(result.current.filterAssignedVar({} as never, ['conversation', 'name'])).toBe(true)
    expect(result.current.filterToAssignedVar({ type: VarType.string } as never, VarType.arrayString, WriteMode.append)).toBe(true)
    expect(result.current.filterToAssignedVar({ type: VarType.number } as never, VarType.arrayString, WriteMode.append)).toBe(false)
  })
})
