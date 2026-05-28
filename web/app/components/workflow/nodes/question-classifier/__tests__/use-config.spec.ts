import type { QuestionClassifierNodeType } from '../types'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useModelListAndDefaultModelAndCurrentProviderAndModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import {
  useIsChatMode,
  useNodesReadOnly,
  useWorkflow,
} from '@/app/components/workflow/hooks'
import useConfigVision from '@/app/components/workflow/hooks/use-config-vision'
import useAvailableVarList from '@/app/components/workflow/nodes/_base/hooks/use-available-var-list'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import { useStore } from '@/app/components/workflow/store'
import { BlockEnum } from '@/app/components/workflow/types'
import { AppModeEnum } from '@/types/app'
import useConfig from '../use-config'

vi.mock('@/app/components/workflow/hooks', () => ({
  useNodesReadOnly: vi.fn(),
  useIsChatMode: vi.fn(),
  useWorkflow: vi.fn(),
}))

vi.mock('reactflow', () => ({
  useUpdateNodeInternals: vi.fn(() => vi.fn()),
}))

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-node-crud', () => ({
  __esModule: true,
  default: vi.fn(),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useModelListAndDefaultModelAndCurrentProviderAndModel: vi.fn(),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: vi.fn(),
}))

vi.mock('@/app/components/workflow/hooks/use-config-vision', () => ({
  __esModule: true,
  default: vi.fn(),
}))

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-available-var-list', () => ({
  __esModule: true,
  default: vi.fn(),
}))

const mockUseNodesReadOnly = vi.mocked(useNodesReadOnly)
const mockUseIsChatMode = vi.mocked(useIsChatMode)
const mockUseWorkflow = vi.mocked(useWorkflow)
const mockUseNodeCrud = vi.mocked(useNodeCrud)
const mockUseModelListAndDefaultModelAndCurrentProviderAndModel = vi.mocked(useModelListAndDefaultModelAndCurrentProviderAndModel)
const mockUseStore = vi.mocked(useStore)
const mockUseConfigVision = vi.mocked(useConfigVision)
const mockUseAvailableVarList = vi.mocked(useAvailableVarList)

const createPayload = (overrides: Partial<QuestionClassifierNodeType> = {}): QuestionClassifierNodeType => ({
  type: BlockEnum.QuestionClassifier,
  title: 'Question Classifier',
  desc: '',
  model: {
    provider: '',
    name: '',
    mode: AppModeEnum.CHAT,
    completion_params: {},
  },
  classes: [{ id: 'topic-1', name: 'Billing questions', label: 'CLASS 1' }],
  query_variable_selector: ['start-node', 'sys.query'],
  instruction: 'Route by topic',
  vision: {
    enabled: false,
  },
  ...overrides,
})

describe('question-classifier/use-config', () => {
  const setInputs = vi.fn()
  let latestVisionOptions: {
    onChange: (payload: QuestionClassifierNodeType['vision']) => void
  } | null = null

  beforeEach(() => {
    vi.clearAllMocks()
    latestVisionOptions = null
    mockUseNodesReadOnly.mockReturnValue({ nodesReadOnly: false, getNodesReadOnly: () => false })
    mockUseIsChatMode.mockReturnValue(true)
    mockUseWorkflow.mockReturnValue({
      getBeforeNodesInSameBranch: vi.fn(() => []),
    } as unknown as ReturnType<typeof useWorkflow>)
    mockUseNodeCrud.mockReturnValue({
      inputs: createPayload(),
      setInputs,
    })
    mockUseModelListAndDefaultModelAndCurrentProviderAndModel.mockReturnValue({
      modelList: [],
      defaultModel: undefined,
      currentProvider: undefined,
      currentModel: undefined,
    } as ReturnType<typeof useModelListAndDefaultModelAndCurrentProviderAndModel>)
    mockUseStore.mockImplementation((selector) => {
      return selector({ nodesDefaultConfigs: {} } as never)
    })
    mockUseConfigVision.mockImplementation((_model, options) => {
      latestVisionOptions = options as typeof latestVisionOptions
      return {
        isVisionModel: false,
        handleVisionResolutionEnabledChange: vi.fn(),
        handleVisionResolutionChange: vi.fn(),
        handleModelChanged: vi.fn(() => {
          latestVisionOptions?.onChange({ enabled: false })
        }),
      }
    })
    mockUseAvailableVarList.mockReturnValue({
      availableVars: [],
      availableNodes: [],
      availableNodesWithParent: [],
    } as unknown as ReturnType<typeof useAvailableVarList>)
  })

  it('preserves the selected model when the vision follow-up updates after model selection', async () => {
    const { result } = renderHook(() => useConfig('question-classifier-node', createPayload()))

    act(() => {
      result.current.handleModelChanged({
        provider: 'openai',
        modelId: 'gpt-4o',
        mode: AppModeEnum.CHAT,
      })
    })

    await waitFor(() => {
      expect(setInputs).toHaveBeenLastCalledWith(expect.objectContaining({
        model: expect.objectContaining({
          provider: 'openai',
          name: 'gpt-4o',
          mode: AppModeEnum.CHAT,
        }),
        vision: {
          enabled: false,
        },
      }))
    })
  })
})
