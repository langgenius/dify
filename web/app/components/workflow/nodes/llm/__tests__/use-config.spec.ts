import type { MutableRefObject } from 'react'
import type { LLMNodeType } from '../types'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useModelListAndDefaultModelAndCurrentProviderAndModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import {
  useIsChatMode,
  useNodesReadOnly,
} from '@/app/components/workflow/hooks'
import useInspectVarsCrud from '@/app/components/workflow/hooks/use-inspect-vars-crud'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import { useStore } from '@/app/components/workflow/store'
import { BlockEnum } from '@/app/components/workflow/types'
import { AppModeEnum, Resolution } from '@/types/app'
import useConfigVision from '../../../hooks/use-config-vision'
import useAvailableVarList from '../../_base/hooks/use-available-var-list'
import useLLMInputManager from '../hooks/use-llm-input-manager'
import useLLMPromptConfig from '../hooks/use-llm-prompt-config'
import useLLMStructuredOutputConfig from '../hooks/use-llm-structured-output-config'
import useConfig from '../use-config'

vi.mock('@/app/components/workflow/hooks', () => ({
  useNodesReadOnly: vi.fn(),
  useIsChatMode: vi.fn(),
}))

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-node-crud', () => ({
  __esModule: true,
  default: vi.fn(),
}))

vi.mock('@/app/components/workflow/hooks/use-inspect-vars-crud', () => ({
  __esModule: true,
  default: vi.fn(),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useModelListAndDefaultModelAndCurrentProviderAndModel: vi.fn(),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: vi.fn(),
}))

vi.mock('../../_base/hooks/use-available-var-list', () => ({
  __esModule: true,
  default: vi.fn(),
}))

vi.mock('../../../hooks/use-config-vision', () => ({
  __esModule: true,
  default: vi.fn(),
}))

vi.mock('../hooks/use-llm-input-manager', () => ({
  __esModule: true,
  default: vi.fn(),
}))

vi.mock('../hooks/use-llm-prompt-config', () => ({
  __esModule: true,
  default: vi.fn(),
}))

vi.mock('../hooks/use-llm-structured-output-config', () => ({
  __esModule: true,
  default: vi.fn(),
}))

const mockUseNodesReadOnly = vi.mocked(useNodesReadOnly)
const mockUseIsChatMode = vi.mocked(useIsChatMode)
const mockUseNodeCrud = vi.mocked(useNodeCrud)
const mockUseInspectVarsCrud = vi.mocked(useInspectVarsCrud)
const mockUseModelListAndDefaultModelAndCurrentProviderAndModel = vi.mocked(useModelListAndDefaultModelAndCurrentProviderAndModel)
const mockUseStore = vi.mocked(useStore)
const mockUseAvailableVarList = vi.mocked(useAvailableVarList)
const mockUseConfigVision = vi.mocked(useConfigVision)
const mockUseLLMInputManager = vi.mocked(useLLMInputManager)
const mockUseLLMPromptConfig = vi.mocked(useLLMPromptConfig)
const mockUseLLMStructuredOutputConfig = vi.mocked(useLLMStructuredOutputConfig)

const createPayload = (overrides: Partial<LLMNodeType> = {}): LLMNodeType => ({
  type: BlockEnum.LLM,
  title: 'LLM',
  desc: '',
  model: {
    provider: 'openai',
    name: 'gpt-4o',
    mode: AppModeEnum.CHAT,
    completion_params: {
      temperature: 0.7,
    },
  },
  prompt_template: [],
  context: {
    enabled: false,
    variable_selector: [],
  },
  vision: {
    enabled: false,
  },
  ...overrides,
})

describe('llm/use-config', () => {
  const setInputs = vi.fn()
  const appendDefaultPromptConfig = vi.fn()
  const deleteNodeInspectorVars = vi.fn()
  const handleVisionConfigAfterModelChanged = vi.fn()
  const handleVisionResolutionEnabledChange = vi.fn()
  const handleVisionResolutionChange = vi.fn()
  const inputRef = { current: createPayload() } as MutableRefObject<LLMNodeType>
  let latestVisionOptions: {
    onChange: (payload: LLMNodeType['vision']) => void
  } | null = null
  const promptConfig = {
    hasSetBlockStatus: {
      history: false,
      query: true,
      context: true,
    },
    shouldShowContextTip: false,
    isShowVars: true,
    handleVarListChange: vi.fn(),
    handleVarNameChange: vi.fn(),
    handleAddVariable: vi.fn(),
    handleAddEmptyVariable: vi.fn(),
    handleContextVarChange: vi.fn(),
    handlePromptChange: vi.fn(),
    handleMemoryChange: vi.fn(),
    handleSyeQueryChange: vi.fn(),
    filterInputVar: vi.fn(),
    filterJinja2InputVar: vi.fn(),
    filterVar: vi.fn(),
  }
  const structuredOutputConfig = {
    isModelSupportStructuredOutput: true,
    handleStructureOutputChange: vi.fn(),
    structuredOutputCollapsed: false,
    setStructuredOutputCollapsed: vi.fn(),
    handleStructureOutputEnableChange: vi.fn(),
    handleReasoningFormatChange: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    inputRef.current = createPayload()
    latestVisionOptions = null
    setInputs.mockImplementation((nextInputs: LLMNodeType) => {
      inputRef.current = nextInputs
    })

    mockUseNodesReadOnly.mockReturnValue({ nodesReadOnly: false, getNodesReadOnly: () => false })
    mockUseIsChatMode.mockReturnValue(true)
    mockUseNodeCrud.mockImplementation(() => ({
      inputs: inputRef.current,
      setInputs: vi.fn(),
    }))
    mockUseInspectVarsCrud.mockReturnValue({
      deleteNodeInspectorVars,
    } as unknown as ReturnType<typeof useInspectVarsCrud>)
    mockUseModelListAndDefaultModelAndCurrentProviderAndModel.mockReturnValue({
      modelList: [],
      defaultModel: undefined,
      currentProvider: undefined,
      currentModel: undefined,
    } as ReturnType<typeof useModelListAndDefaultModelAndCurrentProviderAndModel>)
    mockUseStore.mockImplementation((selector) => {
      return selector({
        nodesDefaultConfigs: {
          [BlockEnum.LLM]: {
            prompt_templates: {
              chat_model: { prompts: [] },
              completion_model: {
                prompt: { text: 'default completion prompt' },
                conversation_histories_role: {
                  user_prefix: 'User',
                  assistant_prefix: 'Assistant',
                },
              },
            },
          },
        },
      } as never)
    })
    mockUseAvailableVarList.mockReturnValue({
      availableVars: [{ nodeId: 'previous-node', title: 'Previous', vars: [] }],
      availableNodes: [],
      availableNodesWithParent: [{ id: 'previous-node', data: { title: 'Previous' } }],
    } as unknown as ReturnType<typeof useAvailableVarList>)
    mockUseConfigVision.mockImplementation((_model, options) => {
      latestVisionOptions = options as typeof latestVisionOptions
      return {
        isVisionModel: false,
        handleVisionResolutionEnabledChange,
        handleVisionResolutionChange,
        handleModelChanged: handleVisionConfigAfterModelChanged,
      }
    })
    mockUseLLMInputManager.mockReturnValue({
      inputRef,
      setInputs,
      appendDefaultPromptConfig,
    } as ReturnType<typeof useLLMInputManager>)
    mockUseLLMPromptConfig.mockReturnValue(promptConfig as ReturnType<typeof useLLMPromptConfig>)
    mockUseLLMStructuredOutputConfig.mockReturnValue(structuredOutputConfig as ReturnType<typeof useLLMStructuredOutputConfig>)
  })

  it('composes the helper hooks, forwards filterVar to available vars, and updates completion params', () => {
    const { result } = renderHook(() => useConfig('llm-node', inputRef.current))

    expect(result.current.readOnly).toBe(false)
    expect(result.current.isChatMode).toBe(true)
    expect(result.current.isChatModel).toBe(true)
    expect(result.current.isCompletionModel).toBe(false)
    expect(result.current.availableVars).toEqual([{ nodeId: 'previous-node', title: 'Previous', vars: [] }])
    expect(result.current.availableNodesWithParent).toEqual([{ id: 'previous-node', data: { title: 'Previous' } }])
    expect(mockUseAvailableVarList).toHaveBeenCalledWith('llm-node', {
      onlyLeafNodeVar: false,
      filterVar: promptConfig.filterVar,
    })
    expect(mockUseLLMInputManager).toHaveBeenCalledWith({
      inputs: inputRef.current,
      doSetInputs: expect.any(Function),
      defaultConfig: expect.objectContaining({
        prompt_templates: expect.any(Object),
      }),
      isChatModel: true,
    })

    act(() => {
      latestVisionOptions?.onChange({
        enabled: true,
        configs: {
          detail: Resolution.high,
          variable_selector: ['sys', 'files'],
        },
      })
      result.current.handleCompletionParamsChange({ top_p: 0.5 })
      result.current.handleModelChanged({
        provider: 'openai',
        modelId: 'gpt-4.1',
        mode: AppModeEnum.CHAT,
      })
    })

    expect(setInputs).toHaveBeenNthCalledWith(1, expect.objectContaining({
      vision: {
        enabled: true,
        configs: {
          detail: Resolution.high,
          variable_selector: ['sys', 'files'],
        },
      },
    }))
    expect(setInputs).toHaveBeenNthCalledWith(2, expect.objectContaining({
      model: expect.objectContaining({
        completion_params: { top_p: 0.5 },
      }),
    }))
    expect(setInputs).toHaveBeenNthCalledWith(3, expect.objectContaining({
      model: expect.objectContaining({
        provider: 'openai',
        name: 'gpt-4.1',
        mode: AppModeEnum.CHAT,
      }),
    }))
    expect(appendDefaultPromptConfig).not.toHaveBeenCalled()
  })

  it('hydrates the model from the current provider, appends mode-specific defaults, and triggers the vision follow-up effect', async () => {
    inputRef.current = createPayload({
      model: {
        provider: '',
        name: '',
        mode: AppModeEnum.COMPLETION,
        completion_params: {},
      },
    })
    mockUseNodeCrud.mockImplementation(() => ({
      inputs: inputRef.current,
      setInputs: vi.fn(),
    }))
    mockUseModelListAndDefaultModelAndCurrentProviderAndModel.mockReturnValue({
      modelList: [],
      defaultModel: undefined,
      currentProvider: { provider: 'anthropic' },
      currentModel: {
        model: 'claude-sonnet',
        model_properties: {
          mode: AppModeEnum.CHAT,
        },
      },
    } as unknown as ReturnType<typeof useModelListAndDefaultModelAndCurrentProviderAndModel>)

    renderHook(() => useConfig('llm-node', inputRef.current))

    await waitFor(() => {
      expect(appendDefaultPromptConfig).toHaveBeenCalled()
      expect(appendDefaultPromptConfig.mock.calls[0]![1]).toEqual(expect.objectContaining({
        prompt_templates: expect.any(Object),
      }))
      expect(appendDefaultPromptConfig.mock.calls[0]![2]).toBe(true)
      expect(setInputs).toHaveBeenCalledWith(expect.objectContaining({
        model: expect.objectContaining({
          provider: 'anthropic',
          name: 'claude-sonnet',
          mode: AppModeEnum.CHAT,
        }),
      }))
      expect(handleVisionConfigAfterModelChanged).toHaveBeenCalled()
    })
  })
})
