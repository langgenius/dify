import type { SchemaDefinitionItemResponse } from '@dify/contracts/api/console/spec/types.gen'
import type { VarInInspect } from '@/types/workflow'
import { act, waitFor } from '@testing-library/react'
import { createNode } from '../../__tests__/fixtures'
import { resetReactFlowMockState, rfState } from '../../__tests__/reactflow-mock-state'
import { renderWorkflowHook } from '../../__tests__/workflow-test-env'
import { BlockEnum, VarType } from '../../types'
import { useInspectVarsCrudCommon } from '../use-inspect-vars-crud-common'

const mockResetInspectorVar = vi.hoisted(() => vi.fn())
const mockDeleteInspectVar = vi.hoisted(() => vi.fn())
const mockDeleteNodeInspectorVars = vi.hoisted(() => vi.fn())
const mockFetchNodeInspectVars = vi.hoisted(() => vi.fn())
const mockDoDeleteAllInspectorVars = vi.hoisted(() => vi.fn())
const mockInvalidateConversationVarValues = vi.hoisted(() => vi.fn())
const mockInvalidateSysVarValues = vi.hoisted(() => vi.fn())
const mockHandleCancelNodeSuccessStatus = vi.hoisted(() => vi.fn())
const mockHandleEdgeCancelRunningStatus = vi.hoisted(() => vi.fn())

const schemaTypeDefinitions: SchemaDefinitionItemResponse[] = [
  {
    name: 'simple',
    label: 'Simple',
    schema: {
      properties: {},
    },
  },
]

vi.mock('reactflow', async () =>
  (await import('../../__tests__/reactflow-mock-state')).createReactFlowModuleMock(),
)

vi.mock('@/service/use-workflow', () => ({
  useInvalidateConversationVarValues: () => mockInvalidateConversationVarValues,
  useInvalidateSysVarValues: () => mockInvalidateSysVarValues,
  useResetInspectorVar: () => ({ mutateAsync: mockResetInspectorVar }),
  useDeleteAllInspectorVars: () => ({ mutateAsync: mockDoDeleteAllInspectorVars }),
  useDeleteNodeInspectorVars: () => ({ mutateAsync: mockDeleteNodeInspectorVars }),
  useDeleteInspectVar: () => ({ mutateAsync: mockDeleteInspectVar }),
  useEditInspectorVar: () => ({ mutateAsync: vi.fn() }),
}))

vi.mock('@tanstack/react-query', async (importOriginal) =>
  (await import('@/test/console/operation-hooks')).mockConsoleOperationHooks(
    await importOriginal(),
    (await import('../../__tests__/service-mock-factory')).createToolOperationRoutes(),
  ),
)

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
          outputs: { answer: { type: VarType.string } },
        },
      }),
    ]
  })

  it('invalidates cached system vars without refetching node values for system selectors', async () => {
    const { result } = renderWorkflowHook(() => useInspectVarsCrudCommon(), {
      initialStoreState: {
        dataSourceList: [],
      },
    })

    await act(async () => {
      await result.current.fetchInspectVarValue(['sys', 'query'], schemaTypeDefinitions)
    })

    expect(mockInvalidateSysVarValues).toHaveBeenCalledTimes(1)
    expect(mockFetchNodeInspectVars).not.toHaveBeenCalled()
  })

  it('fetches node inspect vars, preserves output values, and marks the node as fetched', async () => {
    mockFetchNodeInspectVars.mockResolvedValue([createInspectVar()])

    const { result, store } = renderWorkflowHook(() => useInspectVarsCrudCommon(), {
      initialStoreState: {
        dataSourceList: [],
        nodesWithInspectVars: [
          {
            nodeId: 'node-1',
            nodePayload: {
              type: BlockEnum.Code,
              title: 'Code',
              desc: '',
            } as never,
            nodeType: BlockEnum.Code,
            title: 'Code',
            vars: [],
          },
        ],
      },
    })

    await act(async () => {
      await result.current.fetchInspectVarValue(['node-1', 'answer'], schemaTypeDefinitions)
    })

    await waitFor(() => {
      expect(mockFetchNodeInspectVars).toHaveBeenCalledWith(
        { kind: 'app', appId: 'app-1', mode: 'workflow' },
        'node-1',
      )
      expect(store.getState().nodesWithInspectVars[0]).toMatchObject({
        nodeId: 'node-1',
        isValueFetched: true,
        vars: [
          expect.objectContaining({
            id: 'var-1',
            schemaType: '',
          }),
        ],
      })
    })
  })

  it('deletes all inspect vars, invalidates cached values, and clears edge running state', async () => {
    mockDoDeleteAllInspectorVars.mockResolvedValue(undefined)

    const { result, store } = renderWorkflowHook(() => useInspectVarsCrudCommon(), {
      initialStoreState: {
        nodesWithInspectVars: [
          {
            nodeId: 'node-1',
            nodePayload: {
              type: BlockEnum.Code,
              title: 'Code',
              desc: '',
            } as never,
            nodeType: BlockEnum.Code,
            title: 'Code',
            vars: [createInspectVar()],
          },
        ],
      },
    })

    await act(async () => {
      await result.current.deleteAllInspectorVars()
    })

    expect(mockDoDeleteAllInspectorVars).toHaveBeenCalledTimes(1)
    expect(mockInvalidateConversationVarValues).toHaveBeenCalledTimes(1)
    expect(mockInvalidateSysVarValues).toHaveBeenCalledTimes(1)
    expect(mockHandleEdgeCancelRunningStatus).toHaveBeenCalledTimes(1)
    expect(store.getState().nodesWithInspectVars).toEqual([])
  })
  it.each(['variable', 'node'] as const)(
    'keeps inspected values when %s deletion fails and removes them only after success',
    async (target) => {
      const { result, store } = renderWorkflowHook(() => useInspectVarsCrudCommon())
      act(() =>
        result.current.appendNodeInspectVars(
          'node-1',
          [createInspectVar()],
          [createNode({ id: 'node-1', data: { type: BlockEnum.Code } })],
        ),
      )
      const deleteRequest =
        target === 'variable' ? mockDeleteInspectVar : mockDeleteNodeInspectorVars
      const deleteValues = () =>
        target === 'variable'
          ? result.current.deleteInspectVar('node-1', 'var-1')
          : result.current.deleteNodeInspectorVars('node-1')
      deleteRequest.mockRejectedValueOnce(new Error('Delete failed'))
      await act(async () => {
        await expect(deleteValues()).resolves.toBeUndefined()
      })
      expect(store.getState().nodesWithInspectVars[0]?.vars).toEqual([createInspectVar()])
      deleteRequest.mockResolvedValueOnce(undefined)
      await act(async () => {
        await deleteValues()
      })
      expect(store.getState().nodesWithInspectVars.flatMap((node) => node.vars ?? [])).toEqual([])
    },
  )

  it('removes a variable reset with no historical value and preserves neighboring schemas', async () => {
    const { result, store } = renderWorkflowHook(() => useInspectVarsCrudCommon())
    const neighbor = createInspectVar({ id: 'var-2', name: 'other', schemaType: '' })
    act(() =>
      result.current.appendNodeInspectVars(
        'node-1',
        [createInspectVar(), neighbor],
        [createNode({ id: 'node-1', data: { type: BlockEnum.Code } })],
      ),
    )
    mockResetInspectorVar.mockResolvedValueOnce(undefined)
    await act(async () => {
      await result.current.resetToLastRunVar('node-1', 'var-1')
    })
    expect(store.getState().nodesWithInspectVars[0]?.vars).toEqual([neighbor])
    expect(mockFetchNodeInspectVars).not.toHaveBeenCalled()
  })
})
