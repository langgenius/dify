import type { SchemaTypeDefinition } from '@/service/use-common'
import type { VarInInspect } from '@/types/workflow'
import { act, waitFor } from '@testing-library/react'
import { FlowType } from '@/types/common'
import { createNode } from '../../__tests__/fixtures'
import { resetReactFlowMockState, rfState } from '../../__tests__/reactflow-mock-state'
import { renderWorkflowHook } from '../../__tests__/workflow-test-env'
import { BlockEnum, VarType } from '../../types'
import { useInspectVarsCrudCommon } from '../use-inspect-vars-crud-common'

const mockFetchNodeInspectVars = vi.hoisted(() => vi.fn())
const mockDoDeleteAllInspectorVars = vi.hoisted(() => vi.fn())
const mockInvalidateConversationVarValues = vi.hoisted(() => vi.fn())
const mockInvalidateSysVarValues = vi.hoisted(() => vi.fn())
const mockHandleCancelNodeSuccessStatus = vi.hoisted(() => vi.fn())
const mockHandleEdgeCancelRunningStatus = vi.hoisted(() => vi.fn())
const mockToNodeOutputVars = vi.hoisted(() => vi.fn())

const schemaTypeDefinitions: SchemaTypeDefinition[] = [{
  name: 'simple',
  schema: {
    properties: {},
  },
}]

vi.mock('reactflow', async () =>
  (await import('../../__tests__/reactflow-mock-state')).createReactFlowModuleMock())

vi.mock('@/service/use-flow', () => ({
  default: () => ({
    useInvalidateConversationVarValues: () => mockInvalidateConversationVarValues,
    useInvalidateSysVarValues: () => mockInvalidateSysVarValues,
    useResetConversationVar: () => ({ mutateAsync: vi.fn() }),
    useResetToLastRunValue: () => ({ mutateAsync: vi.fn() }),
    useDeleteAllInspectorVars: () => ({ mutateAsync: mockDoDeleteAllInspectorVars }),
    useDeleteNodeInspectorVars: () => ({ mutate: vi.fn() }),
    useDeleteInspectVar: () => ({ mutate: vi.fn() }),
    useEditInspectorVar: () => ({ mutateAsync: vi.fn() }),
  }),
}))

vi.mock('@/service/use-tools', async () =>
  (await import('../../__tests__/service-mock-factory')).createToolServiceMock())

vi.mock('@/service/workflow', () => ({
  fetchNodeInspectVars: (...args: unknown[]) => mockFetchNodeInspectVars(...args),
}))

vi.mock('../use-nodes-interactions-without-sync', () => ({
  useNodesInteractionsWithoutSync: () => ({
    handleCancelNodeSuccessStatus: mockHandleCancelNodeSuccessStatus,
  }),
}))

vi.mock('../use-edges-interactions-without-sync', () => ({
  useEdgesInteractionsWithoutSync: () => ({
    handleEdgeCancelRunningStatus: mockHandleEdgeCancelRunningStatus,
  }),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/variable/utils', async importOriginal => ({
  ...(await importOriginal<typeof import('@/app/components/workflow/nodes/_base/components/variable/utils')>()),
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

describe('useInspectVarsCrudCommon', () => {
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

  it('invalidates cached system vars without refetching node values for system selectors', async () => {
    const { result } = renderWorkflowHook(
      () => useInspectVarsCrudCommon({
        flowId: 'flow-1',
        flowType: FlowType.appFlow,
      }),
      {
        initialStoreState: {
          dataSourceList: [],
        },
      },
    )

    await act(async () => {
      await result.current.fetchInspectVarValue(['sys', 'query'], schemaTypeDefinitions)
    })

    expect(mockInvalidateSysVarValues).toHaveBeenCalledTimes(1)
    expect(mockFetchNodeInspectVars).not.toHaveBeenCalled()
  })

  it('fetches node inspect vars, adds schema types, and marks the node as fetched', async () => {
    mockFetchNodeInspectVars.mockResolvedValue([
      createInspectVar(),
    ])

    const { result, store } = renderWorkflowHook(
      () => useInspectVarsCrudCommon({
        flowId: 'flow-1',
        flowType: FlowType.appFlow,
      }),
      {
        initialStoreState: {
          dataSourceList: [],
          nodesWithInspectVars: [{
            nodeId: 'node-1',
            nodePayload: {
              type: BlockEnum.Code,
              title: 'Code',
              desc: '',
            } as never,
            nodeType: BlockEnum.Code,
            title: 'Code',
            vars: [],
          }],
        },
      },
    )

    await act(async () => {
      await result.current.fetchInspectVarValue(['node-1', 'answer'], schemaTypeDefinitions)
    })

    await waitFor(() => {
      expect(mockFetchNodeInspectVars).toHaveBeenCalledWith(FlowType.appFlow, 'flow-1', 'node-1')
      expect(store.getState().nodesWithInspectVars[0]).toMatchObject({
        nodeId: 'node-1',
        isValueFetched: true,
        vars: [
          expect.objectContaining({
            id: 'var-1',
            schemaType: 'simple',
          }),
        ],
      })
    })
  })

  it('deletes all inspect vars, invalidates cached values, and clears edge running state', async () => {
    mockDoDeleteAllInspectorVars.mockResolvedValue(undefined)

    const { result, store } = renderWorkflowHook(
      () => useInspectVarsCrudCommon({
        flowId: 'flow-1',
        flowType: FlowType.appFlow,
      }),
      {
        initialStoreState: {
          nodesWithInspectVars: [{
            nodeId: 'node-1',
            nodePayload: {
              type: BlockEnum.Code,
              title: 'Code',
              desc: '',
            } as never,
            nodeType: BlockEnum.Code,
            title: 'Code',
            vars: [createInspectVar()],
          }],
        },
      },
    )

    await act(async () => {
      await result.current.deleteAllInspectorVars()
    })

    expect(mockDoDeleteAllInspectorVars).toHaveBeenCalledTimes(1)
    expect(mockInvalidateConversationVarValues).toHaveBeenCalledTimes(1)
    expect(mockInvalidateSysVarValues).toHaveBeenCalledTimes(1)
    expect(mockHandleEdgeCancelRunningStatus).toHaveBeenCalledTimes(1)
    expect(store.getState().nodesWithInspectVars).toEqual([])
  })
})
