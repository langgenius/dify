import { FlowType } from '@/types/common'
import { renderWorkflowHook } from '../../__tests__/workflow-test-env'
import useInspectVarsCrud from '../use-inspect-vars-crud'

const mockUseConversationVarValues = vi.fn()
const mockUseSysVarValues = vi.fn()

vi.mock('@/service/use-workflow', () => ({
  useConversationVarValues: (flowType?: FlowType, flowId?: string) => mockUseConversationVarValues(flowType, flowId),
  useSysVarValues: (flowType?: FlowType, flowId?: string) => mockUseSysVarValues(flowType, flowId),
}))

describe('useInspectVarsCrud', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseConversationVarValues.mockReturnValue({ data: [] })
    mockUseSysVarValues.mockReturnValue({ data: [] })
  })

  it('should pass flowId to conversation and system variable queries for app flows', () => {
    renderWorkflowHook(() => useInspectVarsCrud(), {
      hooksStoreProps: {
        configsMap: {
          flowId: 'app-1',
          flowType: FlowType.appFlow,
          fileSettings: {},
        },
      },
    })

    expect(mockUseConversationVarValues).toHaveBeenCalledWith(FlowType.appFlow, 'app-1')
    expect(mockUseSysVarValues).toHaveBeenCalledWith(FlowType.appFlow, 'app-1')
  })

  it('should skip conversation and system variable queries for rag pipelines', () => {
    renderWorkflowHook(() => useInspectVarsCrud(), {
      hooksStoreProps: {
        configsMap: {
          flowId: 'pipeline-1',
          flowType: FlowType.ragPipeline,
          fileSettings: {},
        },
      },
    })

    expect(mockUseConversationVarValues).toHaveBeenCalledWith(FlowType.ragPipeline, '')
    expect(mockUseSysVarValues).toHaveBeenCalledWith(FlowType.ragPipeline, '')
  })

  it('should skip conversation and system variable queries for snippets', () => {
    renderWorkflowHook(() => useInspectVarsCrud(), {
      hooksStoreProps: {
        configsMap: {
          flowId: 'snippet-1',
          flowType: FlowType.snippet,
          fileSettings: {},
        },
      },
    })

    expect(mockUseConversationVarValues).toHaveBeenCalledWith(FlowType.snippet, '')
    expect(mockUseSysVarValues).toHaveBeenCalledWith(FlowType.snippet, '')
  })
})
