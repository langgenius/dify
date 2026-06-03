import type { VarInInspect } from '@/types/workflow'
import { FlowType } from '@/types/common'
import { renderWorkflowHook } from '../../__tests__/workflow-test-env'
import { BlockEnum, VarType } from '../../types'
import useInspectVarsCrud from '../use-inspect-vars-crud'

const mockUseConversationVarValues = vi.hoisted(() => vi.fn())
const mockUseSysVarValues = vi.hoisted(() => vi.fn())

vi.mock('@/service/use-workflow', () => ({
  useConversationVarValues: (...args: unknown[]) => mockUseConversationVarValues(...args),
  useSysVarValues: (...args: unknown[]) => mockUseSysVarValues(...args),
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

describe('useInspectVarsCrud', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseConversationVarValues.mockReturnValue({
      data: [createInspectVar({
        id: 'conversation-var',
        name: 'history',
        selector: ['conversation', 'history'],
      })],
    })
    mockUseSysVarValues.mockReturnValue({
      data: [
        createInspectVar({
          id: 'query-var',
          name: 'query',
          selector: ['sys', 'query'],
        }),
        createInspectVar({
          id: 'files-var',
          name: 'files',
          selector: ['sys', 'files'],
        }),
        createInspectVar({
          id: 'time-var',
          name: 'time',
          selector: ['sys', 'time'],
        }),
      ],
    })
  })

  it('appends query/files system vars to start-node inspect vars and filters them from the system list', () => {
    const hasNodeInspectVars = vi.fn(() => true)
    const deleteAllInspectorVars = vi.fn()
    const fetchInspectVarValue = vi.fn()

    const { result } = renderWorkflowHook(() => useInspectVarsCrud(), {
      initialStoreState: {
        nodesWithInspectVars: [{
          nodeId: 'start-node',
          nodePayload: {
            type: BlockEnum.Start,
            title: 'Start',
            desc: '',
          } as never,
          nodeType: BlockEnum.Start,
          title: 'Start',
          vars: [createInspectVar({
            id: 'start-answer',
            selector: ['start-node', 'answer'],
          })],
        }],
      },
      hooksStoreProps: {
        configsMap: {
          flowId: 'flow-1',
          flowType: FlowType.appFlow,
          fileSettings: {} as never,
        },
        hasNodeInspectVars,
        fetchInspectVarValue,
        editInspectVarValue: vi.fn(),
        renameInspectVarName: vi.fn(),
        appendNodeInspectVars: vi.fn(),
        deleteInspectVar: vi.fn(),
        deleteNodeInspectorVars: vi.fn(),
        deleteAllInspectorVars,
        isInspectVarEdited: vi.fn(() => false),
        resetToLastRunVar: vi.fn(),
        invalidateSysVarValues: vi.fn(),
        resetConversationVar: vi.fn(),
        invalidateConversationVarValues: vi.fn(),
        hasSetInspectVar: vi.fn(() => false),
      },
    })

    expect(result.current.conversationVars).toHaveLength(1)
    expect(result.current.systemVars.map(item => item.name)).toEqual(['time'])
    expect(result.current.nodesWithInspectVars[0]?.vars.map(item => item.name)).toEqual([
      'answer',
      'query',
      'files',
    ])
    expect(result.current.hasNodeInspectVars).toBe(hasNodeInspectVars)
    expect(result.current.fetchInspectVarValue).toBe(fetchInspectVarValue)
    expect(result.current.deleteAllInspectorVars).toBe(deleteAllInspectorVars)
  })

  it('uses an empty flow id for rag pipeline conversation and system value queries', () => {
    renderWorkflowHook(() => useInspectVarsCrud(), {
      hooksStoreProps: {
        configsMap: {
          flowId: 'rag-flow',
          flowType: FlowType.ragPipeline,
          fileSettings: {} as never,
        },
      },
    })

    expect(mockUseConversationVarValues).toHaveBeenCalledWith(FlowType.ragPipeline, '')
    expect(mockUseSysVarValues).toHaveBeenCalledWith(FlowType.ragPipeline, '')
  })
})
