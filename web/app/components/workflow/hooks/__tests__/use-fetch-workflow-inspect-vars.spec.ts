import type { SchemaTypeDefinition } from '@/service/use-common'
import type { VarInInspect } from '@/types/workflow'
import { act, waitFor } from '@testing-library/react'
import { FlowType } from '@/types/common'
import { createNode } from '../../__tests__/fixtures'
import { resetReactFlowMockState, rfState } from '../../__tests__/reactflow-mock-state'
import { renderWorkflowHook } from '../../__tests__/workflow-test-env'
import { BlockEnum, VarType } from '../../types'
import { useSetWorkflowVarsWithValue } from '../use-fetch-workflow-inspect-vars'

const mockFetchAllInspectVars = vi.hoisted(() => vi.fn())
const mockInvalidateConversationVarValues = vi.hoisted(() => vi.fn())
const mockInvalidateSysVarValues = vi.hoisted(() => vi.fn())
const mockHandleCancelAllNodeSuccessStatus = vi.hoisted(() => vi.fn())
const mockToNodeOutputVars = vi.hoisted(() => vi.fn())

const schemaTypeDefinitions: SchemaTypeDefinition[] = [{
  name: 'simple',
  schema: {
    properties: {},
  },
}]

vi.mock('reactflow', async () =>
  (await import('../../__tests__/reactflow-mock-state')).createReactFlowModuleMock())

vi.mock('@/service/use-tools', async () =>
  (await import('../../__tests__/service-mock-factory')).createToolServiceMock())

vi.mock('@/service/use-workflow', () => ({
  useInvalidateConversationVarValues: () => mockInvalidateConversationVarValues,
  useInvalidateSysVarValues: () => mockInvalidateSysVarValues,
}))

vi.mock('@/service/workflow', () => ({
  fetchAllInspectVars: (...args: unknown[]) => mockFetchAllInspectVars(...args),
}))

vi.mock('../use-nodes-interactions-without-sync', () => ({
  useNodesInteractionsWithoutSync: () => ({
    handleCancelAllNodeSuccessStatus: mockHandleCancelAllNodeSuccessStatus,
  }),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/variable/use-match-schema-type', () => ({
  default: () => ({
    schemaTypeDefinitions,
  }),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/variable/utils', () => ({
  toNodeOutputVars: (...args: unknown[]) => mockToNodeOutputVars(...args),
}))

const createInspectVar = (overrides: Partial<VarInInspect> = {}): VarInInspect => ({
  id: 'var-1',
  type: 'node',
  name: 'answer',
  description: 'Answer',
  selector: ['node-1', 'answer'],
  value_type: VarType.string,
  value: 'hello',
  edited: false,
  visible: true,
  is_truncated: false,
  full_content: {
    size_bytes: 5,
    download_url: 'https://example.com/answer.txt',
  },
  ...overrides,
})

describe('use-fetch-workflow-inspect-vars', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetReactFlowMockState()
    rfState.nodes = [
      createNode({
        id: 'node-1',
        data: {
          type: BlockEnum.Code,
          title: 'Code',
          desc: '',
        },
      }),
    ]
    mockToNodeOutputVars.mockReturnValue([{
      nodeId: 'node-1',
      vars: [{
        variable: 'answer',
        schemaType: 'simple',
      }],
    }])
  })

  it('fetches inspect vars, invalidates cached values, and stores schema-enriched node vars', async () => {
    mockFetchAllInspectVars.mockResolvedValue([
      createInspectVar(),
      createInspectVar({
        id: 'missing-node-var',
        selector: ['missing-node', 'answer'],
      }),
    ])

    const { result, store } = renderWorkflowHook(
      () => useSetWorkflowVarsWithValue({
        flowType: FlowType.appFlow,
        flowId: 'flow-1',
      }),
      {
        initialStoreState: {
          dataSourceList: [],
        },
      },
    )

    await act(async () => {
      await result.current.fetchInspectVars({})
    })

    expect(mockInvalidateConversationVarValues).toHaveBeenCalledTimes(1)
    expect(mockInvalidateSysVarValues).toHaveBeenCalledTimes(1)
    expect(mockFetchAllInspectVars).toHaveBeenCalledWith(FlowType.appFlow, 'flow-1')
    expect(mockHandleCancelAllNodeSuccessStatus).toHaveBeenCalledTimes(1)
    expect(store.getState().nodesWithInspectVars).toEqual([
      expect.objectContaining({
        nodeId: 'node-1',
        nodeType: BlockEnum.Code,
        title: 'Code',
        vars: [
          expect.objectContaining({
            id: 'var-1',
            selector: ['node-1', 'answer'],
            schemaType: 'simple',
            value: 'hello',
          }),
        ],
      }),
    ])
  })

  it('accepts passed-in vars and plugin metadata without refetching from the API', async () => {
    const passedInVars = [
      createInspectVar({
        id: 'var-2',
        value: 'passed-in',
      }),
    ]
    const passedInPluginInfo = {
      buildInTools: [],
      customTools: [],
      workflowTools: [],
      mcpTools: [],
      dataSourceList: [],
    }

    const { result, store } = renderWorkflowHook(
      () => useSetWorkflowVarsWithValue({
        flowType: FlowType.appFlow,
        flowId: 'flow-2',
      }),
      {
        initialStoreState: {
          dataSourceList: [],
        },
      },
    )

    await act(async () => {
      await result.current.fetchInspectVars({
        passInVars: true,
        vars: passedInVars,
        passedInAllPluginInfoList: passedInPluginInfo,
        passedInSchemaTypeDefinitions: schemaTypeDefinitions,
      })
    })

    await waitFor(() => {
      expect(mockFetchAllInspectVars).not.toHaveBeenCalled()
      expect(store.getState().nodesWithInspectVars[0]?.vars[0]).toMatchObject({
        id: 'var-2',
        value: 'passed-in',
        schemaType: 'simple',
      })
    })
  })
})
