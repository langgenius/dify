import type { ModelConfig, VisionSetting } from '@/app/components/workflow/types'
import { act, renderHook } from '@testing-library/react'
import { ModelFeatureEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { Resolution } from '@/types/app'
import useConfigVision from '../use-config-vision'

const mockUseTextGenerationCurrentProviderAndModelAndModelList = vi.hoisted(() => vi.fn())
const mockUseIsChatMode = vi.hoisted(() => vi.fn())

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useTextGenerationCurrentProviderAndModelAndModelList: (...args: unknown[]) =>
    mockUseTextGenerationCurrentProviderAndModelAndModelList(...args),
}))

vi.mock('../use-workflow', () => ({
  useIsChatMode: () => mockUseIsChatMode(),
}))

const createModel = (overrides: Partial<ModelConfig> = {}): ModelConfig => ({
  provider: 'openai',
  name: 'gpt-4o',
  mode: 'chat',
  completion_params: [],
  ...overrides,
})

const createVisionPayload = (overrides: Partial<{ enabled: boolean, configs?: VisionSetting }> = {}) => ({
  enabled: false,
  ...overrides,
})

describe('useConfigVision', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseIsChatMode.mockReturnValue(false)
    mockUseTextGenerationCurrentProviderAndModelAndModelList.mockReturnValue({
      currentModel: {
        features: [],
      },
    })
  })

  it('should expose vision capability and enable default chat configs for vision models', () => {
    const onChange = vi.fn()
    mockUseIsChatMode.mockReturnValue(true)
    mockUseTextGenerationCurrentProviderAndModelAndModelList.mockReturnValue({
      currentModel: {
        features: [ModelFeatureEnum.vision],
      },
    })

    const { result } = renderHook(() => useConfigVision(createModel(), {
      payload: createVisionPayload(),
      onChange,
    }))

    expect(result.current.isVisionModel).toBe(true)

    act(() => {
      result.current.handleVisionResolutionEnabledChange(true)
    })

    expect(onChange).toHaveBeenCalledWith({
      enabled: true,
      configs: {
        detail: Resolution.high,
        variable_selector: ['sys', 'files'],
      },
    })
  })

  it('should clear configs when disabling vision resolution', () => {
    const onChange = vi.fn()

    const { result } = renderHook(() => useConfigVision(createModel(), {
      payload: createVisionPayload({
        enabled: true,
        configs: {
          detail: Resolution.low,
          variable_selector: ['node', 'files'],
        },
      }),
      onChange,
    }))

    act(() => {
      result.current.handleVisionResolutionEnabledChange(false)
    })

    expect(onChange).toHaveBeenCalledWith({
      enabled: false,
    })
  })

  it('should update the resolution config payload directly', () => {
    const onChange = vi.fn()
    const config: VisionSetting = {
      detail: Resolution.low,
      variable_selector: ['upstream', 'images'],
    }

    const { result } = renderHook(() => useConfigVision(createModel(), {
      payload: createVisionPayload({ enabled: true }),
      onChange,
    }))

    act(() => {
      result.current.handleVisionResolutionChange(config)
    })

    expect(onChange).toHaveBeenCalledWith({
      enabled: true,
      configs: config,
    })
  })

  it('should disable vision settings when the selected model is no longer a vision model', () => {
    const onChange = vi.fn()

    const { result } = renderHook(() => useConfigVision(createModel(), {
      payload: createVisionPayload({
        enabled: true,
        configs: {
          detail: Resolution.high,
          variable_selector: ['sys', 'files'],
        },
      }),
      onChange,
    }))

    act(() => {
      result.current.handleModelChanged()
    })

    expect(onChange).toHaveBeenCalledWith({
      enabled: false,
    })
  })

  it('should reset enabled vision configs when the model changes but still supports vision', () => {
    const onChange = vi.fn()
    mockUseTextGenerationCurrentProviderAndModelAndModelList.mockReturnValue({
      currentModel: {
        features: [ModelFeatureEnum.vision],
      },
    })

    const { result } = renderHook(() => useConfigVision(createModel(), {
      payload: createVisionPayload({
        enabled: true,
        configs: {
          detail: Resolution.low,
          variable_selector: ['old', 'files'],
        },
      }),
      onChange,
    }))

    act(() => {
      result.current.handleModelChanged()
    })

    expect(onChange).toHaveBeenCalledWith({
      enabled: true,
      configs: {
        detail: Resolution.high,
        variable_selector: [],
      },
    })
  })
})
