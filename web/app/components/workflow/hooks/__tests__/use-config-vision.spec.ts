import type { ModelConfig, VisionSetting } from '@/app/components/workflow/types'
import { act } from '@testing-library/react'
import { ModelFeatureEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { renderEditorHook as renderHook } from '@/app/components/workflow/editor-resource/__tests__/render'
import { Resolution } from '@/types/app'
import useConfigVision from '../use-config-vision'

const mockUseTextGenerationCurrentProviderAndModelAndModelList = vi.hoisted(() => vi.fn())
let chatflowMode = false

vi.mock(
  '@/app/components/header/account-setting/model-provider-page/hooks',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('@/app/components/header/account-setting/model-provider-page/hooks')
    >()),
    useTextGenerationCurrentProviderAndModelAndModelList: (...args: unknown[]) =>
      mockUseTextGenerationCurrentProviderAndModelAndModelList(...args),
  }),
)

const createModel = (overrides: Partial<ModelConfig> = {}): ModelConfig => ({
  provider: 'openai',
  name: 'gpt-4o',
  mode: 'chat',
  completion_params: {},
  ...overrides,
})

const createVisionPayload = (
  overrides: Partial<{ enabled: boolean; configs?: VisionSetting }> = {},
) => ({
  enabled: false,
  ...overrides,
})

describe('useConfigVision', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    chatflowMode = false
    mockUseTextGenerationCurrentProviderAndModelAndModelList.mockReturnValue({
      currentModel: {
        features: [],
      },
      textGenerationModelList: [
        {
          provider: 'openai',
          models: [
            { model: 'gpt-4o', features: [ModelFeatureEnum.vision] },
            { model: 'text-only', features: [] },
          ],
        },
      ],
    })
  })

  it('should expose vision capability and enable default chat configs for vision models', () => {
    const onChange = vi.fn()
    chatflowMode = true
    mockUseTextGenerationCurrentProviderAndModelAndModelList.mockReturnValue({
      currentModel: {
        features: [ModelFeatureEnum.vision],
      },
    })

    const { result } = renderHook(
      () =>
        useConfigVision(createModel(), {
          payload: createVisionPayload(),
          onChange,
        }),
      {
        resource: {
          kind: 'app',
          appId: 'app-1',
          mode: chatflowMode ? 'advanced-chat' : 'workflow',
        },
      },
    )

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

    const { result } = renderHook(
      () =>
        useConfigVision(createModel(), {
          payload: createVisionPayload({
            enabled: true,
            configs: {
              detail: Resolution.low,
              variable_selector: ['node', 'files'],
            },
          }),
          onChange,
        }),
      {
        resource: {
          kind: 'app',
          appId: 'app-1',
          mode: chatflowMode ? 'advanced-chat' : 'workflow',
        },
      },
    )

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

    const { result } = renderHook(
      () =>
        useConfigVision(createModel(), {
          payload: createVisionPayload({ enabled: true }),
          onChange,
        }),
      {
        resource: {
          kind: 'app',
          appId: 'app-1',
          mode: chatflowMode ? 'advanced-chat' : 'workflow',
        },
      },
    )

    act(() => {
      result.current.handleVisionResolutionChange(config)
    })

    expect(onChange).toHaveBeenCalledWith({
      enabled: true,
      configs: config,
    })
  })

  it.each([
    ['text-only', { enabled: false }],
    ['gpt-4o', { enabled: true, configs: { detail: Resolution.high, variable_selector: [] } }],
  ])('returns the vision settings to save with the next model %s', (model, expected) => {
    const onChange = vi.fn()
    const vision = createVisionPayload({
      enabled: true,
      configs: { detail: Resolution.low, variable_selector: ['old', 'files'] },
    })
    const { result } = renderHook(
      () => useConfigVision(createModel(), { payload: vision, onChange }),
      { resource: { kind: 'app', appId: 'app-1', mode: 'workflow' } },
    )

    expect(result.current.getVisionAfterModelChange(createModel({ name: model }), vision)).toEqual(
      expected,
    )
    expect(onChange).not.toHaveBeenCalled()
  })
})
