import type { AppConfigJsonValue } from '@dify/contracts/api/console/apps/types.gen'
import type { TFunction } from 'i18next'
import type { ModerationConfig } from '@/models/debug'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { buildConfigurationDatasetConfigs } from '@/app/components/app/configuration/hooks/configuration-lifecycle/dataset'
import { createPublishHandler } from '@/app/components/app/configuration/hooks/configuration-lifecycle/publish'
import { buildPublishedConfig } from '@/app/components/app/configuration/hooks/configuration-lifecycle/published-config'
import { createFeaturesStore } from '@/app/components/base/features/store'
import { consoleQuery } from '@/service/console'
import { createProviderResponseFixture } from '@/test/console/model-provider'
import {
  createConsoleQueryClient,
  renderWithConsoleQuery as renderWithoutUrlState,
} from '@/test/console/query-data'
import { createAppModelConfigFixture } from '@/test/fixtures/app'
import { withSelectorKey } from '@/test/i18n-mock'
import { createNuqsTestRenderer } from '@/test/nuqs-testing'
import { ModelModeType } from '@/types/app'
import ModerationSettingModal from '../moderation-setting-modal'

const mockNotify = vi.fn()
vi.mock('@/app/notifications', () => ({
  toast: {
    error: (message: string) => mockNotify({ type: 'error', message }),
  },
}))

let mockCodeBasedExtensions: { data: { data: Array<{ name: string; [key: string]: unknown }> } } = {
  data: { data: [] },
}
let mockModelProvidersData: {
  data: { data: Record<string, unknown>[] }
  isPending: boolean
  refetch: ReturnType<typeof vi.fn>
} = {
  data: {
    data: [
      {
        provider: 'langgenius/openai/openai',
        system_configuration: {
          enabled: true,
          current_quota_type: 'paid',
          quota_configurations: [{ quota_type: 'paid', is_valid: true }],
        },
        custom_configuration: { status: 'active' },
      },
    ],
  },
  isPending: false,
  refetch: vi.fn(),
}

const defaultData: ModerationConfig = {
  enabled: true,
  type: 'keywords',
  config: {
    keywords: 'bad\nword',
    inputs_config: { enabled: true, preset_response: 'Input blocked' },
    outputs_config: { enabled: false, preset_response: '' },
  },
}

const onUrlUpdate = vi.fn()
const render = createNuqsTestRenderer(renderWithoutUrlState, () => ({ onUrlUpdate }))

describe('ModerationSettingModal', () => {
  const onSave = vi.fn()
  const renderModal = async (ui: React.ReactElement) => {
    const queryClient = createConsoleQueryClient()
    queryClient.setQueryData(
      consoleQuery.codeBasedExtension.get.queryKey({
        input: { query: { module: 'moderation' } },
      }),
      { module: 'moderation', data: mockCodeBasedExtensions.data.data },
    )
    queryClient.setQueryData(
      consoleQuery.workspaces.current.modelProviders.get.queryKey({ input: {} }),
      {
        data: mockModelProvidersData.data.data.map((provider) => ({
          ...createProviderResponseFixture(),
          ...provider,
        })),
      },
    )
    queryClient.setQueryData(consoleQuery.apiBasedExtension.get.queryKey(), [
      {
        id: 'api-ext-1',
        name: 'Moderation API',
        api_endpoint: 'https://moderation.example.com',
        api_key: 'test-key',
      },
    ])
    await act(async () => {
      render(ui, { queryClient })
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockCodeBasedExtensions = { data: { data: [] } }
    mockModelProvidersData = {
      data: {
        data: [
          {
            provider: 'langgenius/openai/openai',
            system_configuration: {
              enabled: true,
              current_quota_type: 'paid',
              quota_configurations: [{ quota_type: 'paid', is_valid: true }],
            },
            custom_configuration: { status: 'active' },
          },
        ],
      },
      isPending: false,
      refetch: vi.fn(),
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should call onCancel when cancel is clicked', async () => {
    const onCancel = vi.fn()
    await renderModal(
      <ModerationSettingModal data={defaultData} onCancel={onCancel} onSave={onSave} />,
    )

    fireEvent.click(screen.getByText(/operation\.cancel/))

    expect(onCancel).toHaveBeenCalled()
  })

  it('should call onCancel when close icon receives Enter key', async () => {
    const onCancel = vi.fn()
    await renderModal(
      <ModerationSettingModal data={defaultData} onCancel={onCancel} onSave={onSave} />,
    )

    const user = userEvent.setup()
    const closeButton = screen.getByRole('button', { name: 'common.operation.close' })
    closeButton.focus()
    await user.keyboard('{Enter}')

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('should show error when saving without inputs or outputs enabled', async () => {
    const data: ModerationConfig = {
      ...defaultData,
      config: {
        keywords: 'test',
        inputs_config: { enabled: false, preset_response: '' },
        outputs_config: { enabled: false, preset_response: '' },
      },
    }
    await renderModal(<ModerationSettingModal data={data} onCancel={vi.fn()} onSave={onSave} />)

    fireEvent.click(screen.getByText(/operation\.save/))

    expect(mockNotify).toHaveBeenCalledExactlyOnceWith({
      type: 'error',
      message: 'appDebug.feature.moderation.modal.content.condition',
    })
    expect(onSave).not.toHaveBeenCalled()
  })

  it('should show error when keywords type has no keywords', async () => {
    const data: ModerationConfig = {
      ...defaultData,
      config: {
        keywords: '',
        inputs_config: { enabled: true, preset_response: 'blocked' },
        outputs_config: { enabled: false, preset_response: '' },
      },
    }
    await renderModal(<ModerationSettingModal data={data} onCancel={vi.fn()} onSave={onSave} />)

    fireEvent.click(screen.getByText(/operation\.save/))

    expect(mockNotify).toHaveBeenCalledExactlyOnceWith({
      type: 'error',
      message: 'appDebug.errorMessage.valueOfVarRequired:{"key":"keywords"}',
    })
    expect(onSave).not.toHaveBeenCalled()
  })

  it('should save the latest preset response when content textarea changes', async () => {
    const data: ModerationConfig = {
      ...defaultData,
      config: {
        keywords: 'bad',
        inputs_config: { enabled: true, preset_response: 'blocked' },
        outputs_config: { enabled: false, preset_response: '' },
      },
    }
    await renderModal(<ModerationSettingModal data={data} onCancel={vi.fn()} onSave={onSave} />)

    fireEvent.change(
      screen.getByRole('textbox', { name: /feature\.moderation\.modal\.content\.preset/ }),
      {
        target: { value: 'updated blocked response' },
      },
    )
    fireEvent.click(screen.getByText(/operation\.save/))

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          inputs_config: expect.objectContaining({
            preset_response: 'updated blocked response',
          }),
        }),
      }),
    )
  })

  it('should show error when inputs enabled but no preset_response for keywords type', async () => {
    const data: ModerationConfig = {
      ...defaultData,
      config: {
        keywords: 'test',
        inputs_config: { enabled: true, preset_response: '' },
        outputs_config: { enabled: false, preset_response: '' },
      },
    }
    await renderModal(<ModerationSettingModal data={data} onCancel={vi.fn()} onSave={onSave} />)

    fireEvent.click(screen.getByText(/operation\.save/))

    expect(mockNotify).toHaveBeenCalledExactlyOnceWith({
      type: 'error',
      message: 'appDebug.feature.moderation.modal.content.errorMessage',
    })
    expect(onSave).not.toHaveBeenCalled()
  })

  it('should show error when api type has no api_based_extension_id', async () => {
    const data: ModerationConfig = {
      enabled: true,
      type: 'api',
      config: {
        inputs_config: { enabled: true, preset_response: '' },
        outputs_config: { enabled: false, preset_response: '' },
      },
    }
    await renderModal(<ModerationSettingModal data={data} onCancel={vi.fn()} onSave={onSave} />)

    fireEvent.click(screen.getByText(/operation\.save/))

    expect(mockNotify).toHaveBeenCalledExactlyOnceWith({
      type: 'error',
      message: 'appDebug.errorMessage.valueOfVarRequired:{"key":"API Extension"}',
    })
    expect(onSave).not.toHaveBeenCalled()
  })

  it('should save with api_based_extension_id in formatted data for api type', async () => {
    const data: ModerationConfig = {
      enabled: true,
      type: 'api',
      config: {
        api_based_extension_id: 'ext-1',
        inputs_config: { enabled: true, preset_response: '' },
        outputs_config: { enabled: false, preset_response: '' },
      },
    }
    await renderModal(<ModerationSettingModal data={data} onCancel={vi.fn()} onSave={onSave} />)

    // api type doesn't require preset_response, so save should succeed
    fireEvent.click(screen.getByText(/operation\.save/))

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'api',
        config: expect.objectContaining({
          api_based_extension_id: 'ext-1',
        }),
      }),
    )
  })

  it('should show error when outputs enabled but no preset_response for keywords type', async () => {
    const data: ModerationConfig = {
      ...defaultData,
      config: {
        keywords: 'test',
        inputs_config: { enabled: false, preset_response: '' },
        outputs_config: { enabled: true, preset_response: '' },
      },
    }
    await renderModal(<ModerationSettingModal data={data} onCancel={vi.fn()} onSave={onSave} />)

    fireEvent.click(screen.getByText(/operation\.save/))

    expect(mockNotify).toHaveBeenCalledExactlyOnceWith({
      type: 'error',
      message: 'appDebug.feature.moderation.modal.content.errorMessage',
    })
    expect(onSave).not.toHaveBeenCalled()
  })

  it('should select api extension via api selector', async () => {
    await renderModal(
      <ModerationSettingModal
        data={{
          ...defaultData,
          type: 'api',
          config: { inputs_config: { enabled: true, preset_response: '' } },
        }}
        onCancel={vi.fn()}
        onSave={onSave}
      />,
    )

    const user = userEvent.setup()
    await user.click(
      screen.getByRole('button', { name: 'common.apiBasedExtension.selector.placeholder' }),
    )
    await user.click(await screen.findByRole('button', { name: /Moderation API/ }))

    // Trigger save and confirm the chosen extension id is passed through
    fireEvent.click(screen.getByText(/operation\.save/))
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ api_based_extension_id: 'api-ext-1' }),
      }),
    )
  })

  it('should save with openai_moderation type when configured', async () => {
    await renderModal(
      <ModerationSettingModal
        data={{
          enabled: true,
          type: 'openai_moderation',
          config: {
            inputs_config: { enabled: true, preset_response: 'blocked' },
            outputs_config: { enabled: false, preset_response: '' },
          },
        }}
        onCancel={vi.fn()}
        onSave={onSave}
      />,
    )

    fireEvent.click(screen.getByText(/operation\.save/))

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'openai_moderation',
      }),
    )
  })

  it('should handle keyword truncation to 100 chars per line and 100 lines', async () => {
    await renderModal(
      <ModerationSettingModal data={defaultData} onCancel={vi.fn()} onSave={onSave} />,
    )

    const textarea = screen.getByPlaceholderText(
      /feature\.moderation\.modal\.keywords\.placeholder/,
    )
    const lines = Array.from(
      { length: 101 },
      (_, index) => `${index}`.padStart(3, '0') + 'a'.repeat(150),
    )
    fireEvent.change(textarea, { target: { value: lines.join('\n') } })
    const expectedKeywords = lines
      .slice(0, 100)
      .map((line) => line.slice(0, 100))
      .join('\n')
    expect(textarea).toHaveValue(expectedKeywords)
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))
    expect(onSave).toHaveBeenCalledExactlyOnceWith({
      ...defaultData,
      config: { ...defaultData.config, keywords: expectedKeywords },
    })
  })

  it('should save with formatted outputs_config when both enabled', async () => {
    const data: ModerationConfig = {
      ...defaultData,
      config: {
        keywords: 'test',
        inputs_config: { enabled: true, preset_response: 'input blocked' },
        outputs_config: { enabled: true, preset_response: 'output blocked' },
      },
    }
    await renderModal(<ModerationSettingModal data={data} onCancel={vi.fn()} onSave={onSave} />)

    fireEvent.click(screen.getByText(/operation\.save/))

    expect(onSave).toHaveBeenCalledExactlyOnceWith(data)
  })

  it('should handle empty lines in keywords', async () => {
    await renderModal(
      <ModerationSettingModal data={defaultData} onCancel={vi.fn()} onSave={onSave} />,
    )

    const textarea = screen.getByPlaceholderText(
      /feature\.moderation\.modal\.keywords\.placeholder/,
    ) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'word1\n\nword2\n\n' } })

    expect(textarea.value).toBe('word1\n\nword2\n')
  })

  it('should open settings modal when provider link is clicked in OpenAI warning', async () => {
    mockModelProvidersData = {
      data: {
        data: [
          {
            provider: 'langgenius/openai/openai',
            system_configuration: {
              enabled: false,
              current_quota_type: 'free',
              quota_configurations: [],
            },
            custom_configuration: { status: 'no-configure' },
          },
        ],
      },
      isPending: false,
      refetch: vi.fn(),
    }

    await renderModal(
      <ModerationSettingModal
        data={{
          ...defaultData,
          type: 'openai_moderation',
          config: { inputs_config: { enabled: true, preset_response: '' } },
        }}
        onCancel={vi.fn()}
        onSave={onSave}
      />,
    )

    expect(screen.getByRole('button', { name: 'common.operation.save' })).toBeDisabled()
    expect(onSave).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText(/settings\.provider/))

    await waitFor(() =>
      expect(onUrlUpdate.mock.lastCall?.[0].searchParams.get('settings')).toBe('provider'),
    )
  })

  it('should initialize config from form schema when switching to code-based extension', async () => {
    mockCodeBasedExtensions = {
      data: {
        data: [
          {
            name: 'custom-ext',
            label: { 'en-US': 'Custom Extension', 'zh-Hans': '自定义扩展' },
            form_schema: [
              {
                variable: 'api_url',
                label: { 'en-US': 'API URL', 'zh-Hans': 'API 地址' },
                type: 'text-input',
                required: true,
                default: 'https://default.com',
                placeholder: '',
                options: [],
                max_length: 200,
              },
            ],
          },
        ],
      },
    }

    await renderModal(
      <ModerationSettingModal data={defaultData} onCancel={vi.fn()} onSave={onSave} />,
    )

    // Click on the custom extension provider
    fireEvent.click(screen.getByText('Custom Extension'))

    expect(screen.getByDisplayValue('https://default.com')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('switch')[0]!)
    fireEvent.change(
      screen.getByRole('textbox', { name: /feature\.moderation\.modal\.content\.preset/ }),
      {
        target: { value: 'Blocked by extension' },
      },
    )
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))
    expect(onSave).toHaveBeenCalledExactlyOnceWith({
      enabled: true,
      type: 'custom-ext',
      config: {
        api_url: 'https://default.com',
        inputs_config: { enabled: true, preset_response: 'Blocked by extension' },
        outputs_config: { enabled: false },
      },
    })
  })

  it('should show error when required form schema field is empty on save', async () => {
    mockCodeBasedExtensions = {
      data: {
        data: [
          {
            name: 'custom-ext',
            label: { 'en-US': 'Custom Extension', 'zh-Hans': '自定义扩展' },
            form_schema: [
              {
                variable: 'api_url',
                label: { 'en-US': 'API URL', 'zh-Hans': 'API 地址' },
                type: 'text-input',
                required: true,
                default: '',
                placeholder: '',
                options: [],
                max_length: 200,
              },
            ],
          },
        ],
      },
    }

    await renderModal(
      <ModerationSettingModal
        data={{
          ...defaultData,
          type: 'custom-ext',
          config: { inputs_config: { enabled: true, preset_response: 'blocked' } },
        }}
        onCancel={vi.fn()}
        onSave={onSave}
      />,
    )

    fireEvent.click(screen.getByText(/operation\.save/))

    expect(mockNotify).toHaveBeenCalledExactlyOnceWith({
      type: 'error',
      message: 'appDebug.errorMessage.valueOfVarRequired:{"key":"API URL"}',
    })
    expect(onSave).not.toHaveBeenCalled()
  })

  it('should update code-based extension form value and save updated config', async () => {
    mockCodeBasedExtensions = {
      data: {
        data: [
          {
            name: 'custom-ext',
            label: { 'en-US': 'Custom Extension', 'zh-Hans': '自定义扩展' },
            form_schema: [
              {
                variable: 'api_url',
                label: { 'en-US': 'API URL', 'zh-Hans': 'API 地址' },
                type: 'text-input',
                required: true,
                default: '',
                placeholder: 'Enter URL',
                options: [],
                max_length: 200,
              },
            ],
          },
        ],
      },
    }

    await renderModal(
      <ModerationSettingModal
        data={{
          ...defaultData,
          type: 'custom-ext',
          config: {
            inputs_config: { enabled: true, preset_response: 'blocked' },
            outputs_config: { enabled: false, preset_response: '' },
          },
        }}
        onCancel={vi.fn()}
        onSave={onSave}
      />,
    )

    fireEvent.change(screen.getByPlaceholderText('Enter URL'), {
      target: { value: 'https://changed.com' },
    })
    fireEvent.click(screen.getByText(/operation\.save/))

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'custom-ext',
        config: expect.objectContaining({
          api_url: 'https://changed.com',
        }),
      }),
    )
  })

  it.each<{
    scenario: string
    initialConfig: NonNullable<ModerationConfig['config']>
    clear: boolean
    expectedValue?: AppConfigJsonValue
    displayedValue?: string
  }>([
    { scenario: 'without editing an absent optional value', initialConfig: {}, clear: false },
    {
      scenario: 'after explicitly clearing an optional value',
      initialConfig: { optional_token: 'old-token' },
      clear: true,
      expectedValue: '',
    },
    {
      scenario: 'without editing a null extension value',
      initialConfig: { optional_token: null },
      clear: false,
      expectedValue: null,
    },
    {
      scenario: 'without editing a false extension value',
      initialConfig: { optional_token: false },
      clear: false,
      expectedValue: false,
    },
    {
      scenario: 'without editing a zero extension value',
      initialConfig: { optional_token: 0 },
      clear: false,
      expectedValue: 0,
      displayedValue: '0',
    },
    {
      scenario: 'without editing a numeric extension value',
      initialConfig: { optional_token: 42 },
      clear: false,
      expectedValue: 42,
      displayedValue: '42',
    },
  ])(
    'publishes a saved custom moderation configuration $scenario',
    async ({ initialConfig, clear, expectedValue, displayedValue }) => {
      const user = userEvent.setup()
      mockCodeBasedExtensions = {
        data: {
          data: [
            {
              name: 'custom-ext',
              label: { 'en-US': 'Custom Extension', 'zh-Hans': '自定义扩展' },
              form_schema: [
                {
                  variable: 'optional_token',
                  label: { 'en-US': 'Optional token', 'zh-Hans': '可选令牌' },
                  type: 'text-input',
                  required: false,
                  default: '',
                  placeholder: 'Optional token',
                  options: [],
                },
              ],
            },
          ],
        },
      }
      const featuresStore = createFeaturesStore()
      await renderModal(
        <ModerationSettingModal
          data={{
            enabled: true,
            type: 'custom-ext',
            config: {
              ...initialConfig,
              inputs_config: { enabled: true, preset_response: 'Blocked' },
              outputs_config: { enabled: false },
            },
          }}
          onCancel={vi.fn()}
          onSave={(moderation) => {
            const { features, setFeatures } = featuresStore.getState()
            setFeatures({ ...features, moderation })
          }}
        />,
      )
      const optionalToken = screen.getByPlaceholderText('Optional token')
      if (clear) await user.clear(optionalToken)
      else expect(optionalToken).toHaveValue(displayedValue ?? '')

      if (clear) await user.keyboard('{Enter}')
      else await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

      const backendModelConfig = createAppModelConfigFixture({
        model: { provider: 'openai', name: 'gpt-4o', mode: 'chat', completion_params: {} },
      })
      const config = buildPublishedConfig({
        backendModelConfig,
        collectionList: [],
        datasetConfigs: buildConfigurationDatasetConfigs({ backendModelConfig, nextDataSets: [] }),
        mode: 'chat' as const,
        nextDataSets: [],
      })
      const publish = createPublishHandler({
        appId: 'app-1',
        chatPromptConfig: config.chatPromptConfig,
        completionParamsState: config.completionParams,
        completionPromptConfig: config.completionPromptConfig,
        contextVarEmpty: false,
        dataSets: [],
        datasetConfigs: config.datasetConfigs,
        externalDataToolsConfig: [],
        hasSetBlockStatus: { history: true, query: true },
        isAdvancedMode: false,
        isFunctionCall: false,
        mode: 'chat' as const,
        modelConfig: config.modelConfig,
        promptEmpty: false,
        promptMode: 'simple',
        resolvedModelModeType: ModelModeType.chat,
        setCanReturnToSimpleMode: vi.fn(),
        setPublishedConfig: vi.fn(),
        t: withSelectorKey((key: string) => key) as TFunction<['appDebug', 'common']>,
      })
      const updateModelConfig = vi.fn<Parameters<typeof publish>[0]>().mockResolvedValue(undefined)
      await publish(updateModelConfig, undefined, featuresStore.getState().features)

      expect(updateModelConfig).toHaveBeenCalledTimes(1)
      const moderation = updateModelConfig.mock.calls[0]?.[0].body.sensitive_word_avoidance
      expect(moderation).toMatchObject({
        enabled: true,
        type: 'custom-ext',
        config: { inputs_config: { enabled: true, preset_response: 'Blocked' } },
      })
      if (expectedValue !== undefined)
        expect(moderation?.config).toHaveProperty('optional_token', expectedValue)
      else expect(moderation?.config).not.toHaveProperty('optional_token')
    },
  )

  it('should fallback missing inputs_config to disabled in formatted save data', async () => {
    await renderModal(
      <ModerationSettingModal
        data={{
          enabled: true,
          type: 'api',
          config: {
            api_based_extension_id: 'ext-fallback',
            outputs_config: { enabled: true, preset_response: '' },
          },
        }}
        onCancel={vi.fn()}
        onSave={onSave}
      />,
    )

    fireEvent.click(screen.getByText(/operation\.save/))

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'api',
        config: expect.objectContaining({
          inputs_config: expect.objectContaining({ enabled: false }),
          outputs_config: expect.objectContaining({ enabled: true }),
        }),
      }),
    )
  })
})
