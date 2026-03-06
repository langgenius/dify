import { resetReactFlowMockState, rfState } from '../../__tests__/reactflow-mock-state'
import { renderWorkflowHook } from '../../__tests__/workflow-test-env'
import { useWorkflowVariables, useWorkflowVariableType } from '../use-workflow-variables'

vi.mock('reactflow', async () =>
  (await import('../../__tests__/reactflow-mock-state')).createReactFlowModuleMock())

vi.mock('@/service/use-tools', async () =>
  (await import('../../__tests__/service-mock-factory')).createToolServiceMock())

const { mockToNodeAvailableVars, mockGetVarType } = vi.hoisted(() => ({
  mockToNodeAvailableVars: vi.fn((_args: Record<string, unknown>) => [] as unknown[]),
  mockGetVarType: vi.fn((_args: Record<string, unknown>) => 'string' as string),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/variable/utils', () => ({
  toNodeAvailableVars: mockToNodeAvailableVars,
  getVarType: mockGetVarType,
}))

vi.mock('../../nodes/_base/components/variable/use-match-schema-type', () => ({
  default: () => ({ schemaTypeDefinitions: [] }),
}))

let mockIsChatMode = false
vi.mock('../use-workflow', () => ({
  useIsChatMode: () => mockIsChatMode,
}))

describe('useWorkflowVariables', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getNodeAvailableVars', () => {
    it('should call toNodeAvailableVars with store data', () => {
      const { result } = renderWorkflowHook(() => useWorkflowVariables(), {
        initialStoreState: {
          conversationVariables: [{ id: 'cv1' }] as never[],
          environmentVariables: [{ id: 'ev1' }] as never[],
        },
      })

      result.current.getNodeAvailableVars({
        beforeNodes: [],
        isChatMode: true,
        filterVar: () => true,
      })

      expect(mockToNodeAvailableVars).toHaveBeenCalledOnce()
      const args = mockToNodeAvailableVars.mock.calls[0][0]
      expect(args.isChatMode).toBe(true)
      expect(args.conversationVariables).toHaveLength(1)
      expect(args.environmentVariables).toHaveLength(1)
    })

    it('should hide env variables when hideEnv is true', () => {
      const { result } = renderWorkflowHook(() => useWorkflowVariables(), {
        initialStoreState: {
          environmentVariables: [{ id: 'ev1' }] as never[],
        },
      })

      result.current.getNodeAvailableVars({
        beforeNodes: [],
        isChatMode: false,
        filterVar: () => true,
        hideEnv: true,
      })

      const args = mockToNodeAvailableVars.mock.calls[0][0]
      expect(args.environmentVariables).toEqual([])
    })

    it('should hide chat variables when not in chat mode', () => {
      const { result } = renderWorkflowHook(() => useWorkflowVariables(), {
        initialStoreState: {
          conversationVariables: [{ id: 'cv1' }] as never[],
        },
      })

      result.current.getNodeAvailableVars({
        beforeNodes: [],
        isChatMode: false,
        filterVar: () => true,
      })

      const args = mockToNodeAvailableVars.mock.calls[0][0]
      expect(args.conversationVariables).toEqual([])
    })
  })

  describe('getCurrentVariableType', () => {
    it('should call getVarType with store data and return the result', () => {
      mockGetVarType.mockReturnValue('number')

      const { result } = renderWorkflowHook(() => useWorkflowVariables())

      const type = result.current.getCurrentVariableType({
        valueSelector: ['node-1', 'output'],
        availableNodes: [],
        isChatMode: false,
      })

      expect(mockGetVarType).toHaveBeenCalledOnce()
      expect(type).toBe('number')
    })
  })
})

describe('useWorkflowVariableType', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetReactFlowMockState()
    mockIsChatMode = false
    rfState.nodes = [
      { id: 'n1', position: { x: 0, y: 0 }, data: { isInIteration: false } },
      { id: 'n2', position: { x: 300, y: 0 }, data: { isInIteration: true }, parentId: 'iter-1' },
      { id: 'iter-1', position: { x: 0, y: 200 }, data: {} },
    ]
  })

  it('should return a function', () => {
    const { result } = renderWorkflowHook(() => useWorkflowVariableType())
    expect(typeof result.current).toBe('function')
  })

  it('should call getCurrentVariableType with the correct node', () => {
    mockGetVarType.mockReturnValue('string')

    const { result } = renderWorkflowHook(() => useWorkflowVariableType())
    const type = result.current({ nodeId: 'n1', valueSelector: ['n1', 'output'] })

    expect(mockGetVarType).toHaveBeenCalledOnce()
    expect(type).toBe('string')
  })

  it('should pass iterationNode as parentNode when node is in iteration', () => {
    mockGetVarType.mockReturnValue('array')

    const { result } = renderWorkflowHook(() => useWorkflowVariableType())
    result.current({ nodeId: 'n2', valueSelector: ['n2', 'item'] })

    const args = mockGetVarType.mock.calls[0][0]
    expect(args.parentNode).toBeDefined()
    expect((args.parentNode as { id: string }).id).toBe('iter-1')
  })
})
