import type { AppConfigJsonValue } from '@dify/contracts/api/console/apps/types.gen'
import type { TFunction } from 'i18next'
import type { ModerationConfig } from '@/models/debug'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as i18n from 'react-i18next'
import { buildConfigurationDatasetConfigs } from '@/app/components/app/configuration/hooks/configuration-lifecycle/dataset'
import { createPublishHandler } from '@/app/components/app/configuration/hooks/configuration-lifecycle/publish'
import { buildPublishedConfig } from '@/app/components/app/configuration/hooks/configuration-lifecycle/published-config'
import { createFeaturesStore } from '@/app/components/base/features/store'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { createAppModelConfigFixture } from '@/test/fixtures/app'
import { withSelectorKey } from '@/test/i18n-mock'
import { AppModeEnum, ModelModeType } from '@/types/app'
import { ModerationSettingModal } from '../moderation-setting-modal'

const mockNotify = vi.fn()
vi.mock('@/app/notifications', () => ({
  toast: {
    error: (message: string) => mockNotify({ type: 'error', message }),
  },
}))

const mockSetSettingsDestination = vi.fn()
vi.mock('nuqs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('nuqs')>()
  return { ...actual, useQueryState: () => [null, mockSetSettingsDestination] }
})

let mockCodeBasedExtensions: { data: { data: Record<string, unknown>[] } } = { data: { data: [] } }
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

vi.mock('@/service/use-common', () => ({
  useCodeBasedExtensions: () => mockCodeBasedExtensions,
  useModelProviderDetails: () => mockModelProvidersData,
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/declarations', () => ({
  CustomConfigurationStatusEnum: { active: 'active' },
}))

vi.mock('@/app/components/header/account-setting/api-based-extension-page/selector', () => ({
  ApiBasedExtensionSelector: ({ onChange }: { value: string; onChange: (v: string) => void }) => (
    <div data-testid="api-selector">
      <button data-testid="select-api" onClick={() => onChange('api-ext-1')}>
        Select API
      </button>
    </div>
  ),
}))

const defaultData: ModerationConfig = {
  enabled: true,
  type: 'keywords',
  config: {
    keywords: 'bad\nword',
    inputs_config: { enabled: true, preset_response: 'Input blocked' },
    outputs_config: { enabled: false, preset_response: '' },
  },
}

describe('ModerationSettingModal', () => {
  const onSave = vi.fn()
  const renderModal = async (ui: React.ReactElement) => {
    await act(async () => {
      render(ui)
      await Promise.resolve()
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

  it('should render the modal title', async () => {
    await renderModal(
      <ModerationSettingModal open data={defaultData} onOpenChange={vi.fn()} onSave={onSave} />,
    )

    expect(screen.getByText(/feature\.moderation\.modal\.title/))!.toBeInTheDocument()
  })

  it('should render provider options', async () => {
    await renderModal(
      <ModerationSettingModal open data={defaultData} onOpenChange={vi.fn()} onSave={onSave} />,
    )

    expect(screen.getByText(/feature\.moderation\.modal\.provider\.openai/))!.toBeInTheDocument()
    // Keywords text appears both as provider option and section label
    expect(
      screen.getAllByText(/feature\.moderation\.modal\.provider\.keywords/).length,
    ).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/apiBasedExtension\.selector\.title/))!.toBeInTheDocument()
  })

  it('should show keywords textarea when keywords type is selected', async () => {
    await renderModal(
      <ModerationSettingModal open data={defaultData} onOpenChange={vi.fn()} onSave={onSave} />,
    )

    const textarea = screen.getByPlaceholderText(
      /feature\.moderation\.modal\.keywords\.placeholder/,
    ) as HTMLTextAreaElement
    expect(textarea)!.toBeInTheDocument()
    expect(textarea)!.toHaveValue('bad\nword')
  })

  it('should render cancel and save buttons', async () => {
    await renderModal(
      <ModerationSettingModal open data={defaultData} onOpenChange={vi.fn()} onSave={onSave} />,
    )

    expect(screen.getByText(/operation\.cancel/))!.toBeInTheDocument()
    expect(screen.getByText(/operation\.save/))!.toBeInTheDocument()
  })

  it('should call onCancel when cancel is clicked', async () => {
    const onCancel = vi.fn()
    await renderModal(
      <ModerationSettingModal open data={defaultData} onOpenChange={onCancel} onSave={onSave} />,
    )

    fireEvent.click(screen.getByText(/operation\.cancel/))

    expect(onCancel).toHaveBeenCalled()
  })

  it('should call onCancel when close icon receives Enter key', async () => {
    const onCancel = vi.fn()
    await renderModal(
      <ModerationSettingModal open data={defaultData} onOpenChange={onCancel} onSave={onSave} />,
    )

    const user = userEvent.setup()
    const closeButton = screen.getByRole('button', { name: 'common.operation.close' })
    closeButton.focus()
    await user.keyboard('{Enter}')

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('should call onCancel when close icon receives Space key', async () => {
    const onCancel = vi.fn()
    await renderModal(
      <ModerationSettingModal open data={defaultData} onOpenChange={onCancel} onSave={onSave} />,
    )

    const user = userEvent.setup()
    const closeButton = screen.getByRole('button', { name: 'common.operation.close' })
    closeButton.focus()
    await user.keyboard(' ')

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('should request cancellation when Escape is pressed', async () => {
    const onCancel = vi.fn()
    await renderModal(
      <ModerationSettingModal open data={defaultData} onOpenChange={onCancel} onSave={onSave} />,
    )

    const closeButton = screen.getByRole('button', { name: 'common.operation.close' })
    closeButton.focus()
    fireEvent.keyDown(closeButton, { key: 'Escape' })

    expect(onCancel).toHaveBeenCalledExactlyOnceWith(false, expect.anything())
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
    await renderModal(
      <ModerationSettingModal open data={data} onOpenChange={vi.fn()} onSave={onSave} />,
    )

    fireEvent.click(screen.getByText(/operation\.save/))

    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
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
    await renderModal(
      <ModerationSettingModal open data={data} onOpenChange={vi.fn()} onSave={onSave} />,
    )

    fireEvent.click(screen.getByText(/operation\.save/))

    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
  })

  it('should call onSave with formatted data when valid', async () => {
    const data: ModerationConfig = {
      ...defaultData,
      config: {
        keywords: 'bad\nword',
        inputs_config: { enabled: true, preset_response: 'blocked' },
        outputs_config: { enabled: false, preset_response: '' },
      },
    }
    await renderModal(
      <ModerationSettingModal open data={data} onOpenChange={vi.fn()} onSave={onSave} />,
    )

    fireEvent.click(screen.getByText(/operation\.save/))

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'keywords',
        enabled: true,
        config: expect.objectContaining({
          keywords: 'bad\nword',
          inputs_config: expect.objectContaining({ enabled: true }),
        }),
      }),
    )
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
    await renderModal(
      <ModerationSettingModal open data={data} onOpenChange={vi.fn()} onSave={onSave} />,
    )

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

  it('should show api selector when api type is selected', async () => {
    await renderModal(
      <ModerationSettingModal
        open
        data={{
          ...defaultData,
          type: 'api',
          config: { inputs_config: { enabled: true, preset_response: '' } },
        }}
        onOpenChange={vi.fn()}
        onSave={onSave}
      />,
    )

    expect(screen.getByTestId('api-selector'))!.toBeInTheDocument()
  })

  it('should switch provider type when clicked', async () => {
    await renderModal(
      <ModerationSettingModal open data={defaultData} onOpenChange={vi.fn()} onSave={onSave} />,
    )

    // Click on openai_moderation provider
    fireEvent.click(screen.getByText(/feature\.moderation\.modal\.provider\.openai/))

    // The keywords textarea should no longer be visible since type changed
    // The keywords textarea should no longer be visible since type changed
    // The keywords textarea should no longer be visible since type changed
    // The keywords textarea should no longer be visible since type changed
    // The keywords textarea should no longer be visible since type changed
    // The keywords textarea should no longer be visible since type changed
    // The keywords textarea should no longer be visible since type changed
    // The keywords textarea should no longer be visible since type changed
    // The keywords textarea should no longer be visible since type changed
    // The keywords textarea should no longer be visible since type changed
    // The keywords textarea should no longer be visible since type changed
    // The keywords textarea should no longer be visible since type changed
    // The keywords textarea should no longer be visible since type changed
    // The keywords textarea should no longer be visible since type changed
    // The keywords textarea should no longer be visible since type changed
    // The keywords textarea should no longer be visible since type changed
    // The keywords textarea should no longer be visible since type changed
    // The keywords textarea should no longer be visible since type changed
    // The keywords textarea should no longer be visible since type changed
    // The keywords textarea should no longer be visible since type changed
    // The keywords textarea should no longer be visible since type changed
    // The keywords textarea should no longer be visible since type changed
    // The keywords textarea should no longer be visible since type changed
    // The keywords textarea should no longer be visible since type changed
    // The keywords textarea should no longer be visible since type changed
    // The keywords textarea should no longer be visible since type changed
    // The keywords textarea should no longer be visible since type changed
    // The keywords textarea should no longer be visible since type changed
    // The keywords textarea should no longer be visible since type changed
    // The keywords textarea should no longer be visible since type changed
    // The keywords textarea should no longer be visible since type changed
    // The keywords textarea should no longer be visible since type changed
    expect(
      screen.queryByPlaceholderText(/feature\.moderation\.modal\.keywords\.placeholder/),
    ).not.toBeInTheDocument()
  })

  it('should update keywords on textarea change', async () => {
    await renderModal(
      <ModerationSettingModal open data={defaultData} onOpenChange={vi.fn()} onSave={onSave} />,
    )

    const textarea = screen.getByPlaceholderText(
      /feature\.moderation\.modal\.keywords\.placeholder/,
    ) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'new\nkeywords' } })

    expect(textarea)!.toHaveValue('new\nkeywords')
  })

  it('should render moderation content sections', async () => {
    await renderModal(
      <ModerationSettingModal open data={defaultData} onOpenChange={vi.fn()} onSave={onSave} />,
    )

    expect(screen.getByText(/feature\.moderation\.modal\.content\.input/))!.toBeInTheDocument()
    expect(screen.getByText(/feature\.moderation\.modal\.content\.output/))!.toBeInTheDocument()
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
    await renderModal(
      <ModerationSettingModal open data={data} onOpenChange={vi.fn()} onSave={onSave} />,
    )

    fireEvent.click(screen.getByText(/operation\.save/))

    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
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
    await renderModal(
      <ModerationSettingModal open data={data} onOpenChange={vi.fn()} onSave={onSave} />,
    )

    fireEvent.click(screen.getByText(/operation\.save/))

    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
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
    await renderModal(
      <ModerationSettingModal open data={data} onOpenChange={vi.fn()} onSave={onSave} />,
    )

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
    await renderModal(
      <ModerationSettingModal open data={data} onOpenChange={vi.fn()} onSave={onSave} />,
    )

    fireEvent.click(screen.getByText(/operation\.save/))

    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
  })

  it('should toggle input moderation content', async () => {
    await renderModal(
      <ModerationSettingModal open data={defaultData} onOpenChange={vi.fn()} onSave={onSave} />,
    )

    const switches = screen.getAllByRole('switch')
    expect(
      screen.getAllByPlaceholderText(/feature\.moderation\.modal\.content\.placeholder/),
    ).toHaveLength(1)

    fireEvent.click(switches[0]!)

    expect(
      screen.queryAllByPlaceholderText(/feature\.moderation\.modal\.content\.placeholder/),
    ).toHaveLength(0)
  })

  it('should toggle output moderation content', async () => {
    await renderModal(
      <ModerationSettingModal open data={defaultData} onOpenChange={vi.fn()} onSave={onSave} />,
    )

    const switches = screen.getAllByRole('switch')
    expect(
      screen.getAllByPlaceholderText(/feature\.moderation\.modal\.content\.placeholder/),
    ).toHaveLength(1)

    fireEvent.click(switches[1]!)

    expect(
      screen.getAllByPlaceholderText(/feature\.moderation\.modal\.content\.placeholder/),
    ).toHaveLength(2)
  })

  it('should select api extension via api selector', async () => {
    await renderModal(
      <ModerationSettingModal
        open
        data={{
          ...defaultData,
          type: 'api',
          config: { inputs_config: { enabled: true, preset_response: '' } },
        }}
        onOpenChange={vi.fn()}
        onSave={onSave}
      />,
    )

    fireEvent.click(screen.getByTestId('select-api'))

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
        open
        data={{
          enabled: true,
          type: 'openai_moderation',
          config: {
            inputs_config: { enabled: true, preset_response: 'blocked' },
            outputs_config: { enabled: false, preset_response: '' },
          },
        }}
        onOpenChange={vi.fn()}
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
      <ModerationSettingModal open data={defaultData} onOpenChange={vi.fn()} onSave={onSave} />,
    )

    const textarea = screen.getByPlaceholderText(
      /feature\.moderation\.modal\.keywords\.placeholder/,
    )
    // Create a long keyword that exceeds 100 chars
    const longWord = 'a'.repeat(150)
    fireEvent.change(textarea, { target: { value: longWord } })

    // Value should be truncated to 100 chars
    expect((textarea as HTMLTextAreaElement).value.length).toBeLessThanOrEqual(100)
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
    await renderModal(
      <ModerationSettingModal open data={data} onOpenChange={vi.fn()} onSave={onSave} />,
    )

    fireEvent.click(screen.getByText(/operation\.save/))

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          inputs_config: expect.objectContaining({ enabled: true }),
          outputs_config: expect.objectContaining({ enabled: true }),
        }),
      }),
    )
  })

  it('should switch from keywords to api type', async () => {
    await renderModal(
      <ModerationSettingModal open data={defaultData} onOpenChange={vi.fn()} onSave={onSave} />,
    )

    // Click api provider
    fireEvent.click(screen.getByText(/apiBasedExtension\.selector\.title/))

    // API selector should now be visible, keywords textarea should be hidden
    // API selector should now be visible, keywords textarea should be hidden
    expect(screen.getByTestId('api-selector'))!.toBeInTheDocument()
    expect(
      screen.queryByPlaceholderText(/feature\.moderation\.modal\.keywords\.placeholder/),
    ).not.toBeInTheDocument()
  })

  it('should handle empty lines in keywords', async () => {
    await renderModal(
      <ModerationSettingModal open data={defaultData} onOpenChange={vi.fn()} onSave={onSave} />,
    )

    const textarea = screen.getByPlaceholderText(
      /feature\.moderation\.modal\.keywords\.placeholder/,
    ) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'word1\n\nword2\n\n' } })

    expect(textarea.value).toBe('word1\n\nword2\n')
  })

  it('should show OpenAI not configured warning when OpenAI provider is not set up', async () => {
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
        open
        data={{
          ...defaultData,
          type: 'openai_moderation',
          config: { inputs_config: { enabled: true, preset_response: '' } },
        }}
        onOpenChange={vi.fn()}
        onSave={onSave}
      />,
    )

    expect(
      screen.getByText(/feature\.moderation\.modal\.openaiNotConfig\.before/),
    )!.toBeInTheDocument()
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
        open
        data={{
          ...defaultData,
          type: 'openai_moderation',
          config: { inputs_config: { enabled: true, preset_response: '' } },
        }}
        onOpenChange={vi.fn()}
        onSave={onSave}
      />,
    )

    fireEvent.click(screen.getByText(/settings\.provider/))

    expect(mockSetSettingsDestination).toHaveBeenCalledWith('provider')
  })

  it('should not save when OpenAI type is selected but not configured', async () => {
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
        open
        data={{
          ...defaultData,
          type: 'openai_moderation',
          config: {
            inputs_config: { enabled: true, preset_response: 'blocked' },
            outputs_config: { enabled: false, preset_response: '' },
          },
        }}
        onOpenChange={vi.fn()}
        onSave={onSave}
      />,
    )

    fireEvent.click(screen.getByText(/operation\.save/))

    expect(onSave).not.toHaveBeenCalled()
  })

  it('should render code-based extension providers', async () => {
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
      <ModerationSettingModal open data={defaultData} onOpenChange={vi.fn()} onSave={onSave} />,
    )

    expect(screen.getByText('Custom Extension'))!.toBeInTheDocument()
  })

  it('should show form generation when code-based extension is selected', async () => {
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
        open
        data={{
          ...defaultData,
          type: 'custom-ext',
          config: { inputs_config: { enabled: true, preset_response: '' } },
        }}
        onOpenChange={vi.fn()}
        onSave={onSave}
      />,
    )

    expect(screen.getByText('API URL'))!.toBeInTheDocument()
    expect(screen.getByPlaceholderText('Enter URL'))!.toBeInTheDocument()
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
      <ModerationSettingModal open data={defaultData} onOpenChange={vi.fn()} onSave={onSave} />,
    )

    // Click on the custom extension provider
    fireEvent.click(screen.getByText('Custom Extension'))

    // The form input should use the default value from form schema
    // The form input should use the default value from form schema
    expect(screen.getByDisplayValue('https://default.com'))!.toBeInTheDocument()
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
        open
        data={{
          ...defaultData,
          type: 'custom-ext',
          config: { inputs_config: { enabled: true, preset_response: 'blocked' } },
        }}
        onOpenChange={vi.fn()}
        onSave={onSave}
      />,
    )

    fireEvent.click(screen.getByText(/operation\.save/))

    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
  })

  it('should save with code-based extension config when valid', async () => {
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
        open
        data={{
          ...defaultData,
          type: 'custom-ext',
          config: {
            api_url: 'https://example.com',
            inputs_config: { enabled: true, preset_response: 'blocked' },
            outputs_config: { enabled: false, preset_response: '' },
          },
        }}
        onOpenChange={vi.fn()}
        onSave={onSave}
      />,
    )

    fireEvent.click(screen.getByText(/operation\.save/))

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'custom-ext',
        config: expect.objectContaining({
          api_url: 'https://example.com',
        }),
      }),
    )
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
        open
        data={{
          ...defaultData,
          type: 'custom-ext',
          config: {
            inputs_config: { enabled: true, preset_response: 'blocked' },
            outputs_config: { enabled: false, preset_response: '' },
          },
        }}
        onOpenChange={vi.fn()}
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

  it('should show doc link for api type', async () => {
    await renderModal(
      <ModerationSettingModal
        open
        data={{
          ...defaultData,
          type: 'api',
          config: { inputs_config: { enabled: true, preset_response: '' } },
        }}
        onOpenChange={vi.fn()}
        onSave={onSave}
      />,
    )

    expect(screen.getByText(/apiBasedExtension\.link/))!.toBeInTheDocument()
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
          open
          data={{
            enabled: true,
            type: 'custom-ext',
            config: {
              ...initialConfig,
              inputs_config: { enabled: true, preset_response: 'Blocked' },
              outputs_config: { enabled: false },
            },
          }}
          onOpenChange={vi.fn()}
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
        mode: AppModeEnum.CHAT,
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
        mode: AppModeEnum.CHAT,
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
        open
        data={{
          enabled: true,
          type: 'api',
          config: {
            api_based_extension_id: 'ext-fallback',
            outputs_config: { enabled: true, preset_response: '' },
          },
        }}
        onOpenChange={vi.fn()}
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

  it('should fallback to empty translated strings for optional placeholders and titles', async () => {
    const useTranslationSpy = vi.spyOn(i18n, 'useTranslation').mockReturnValue({
      t: withSelectorKey((key: string) =>
        [
          'feature.moderation.modal.keywords.placeholder',
          'feature.moderation.modal.content.input',
          'feature.moderation.modal.content.output',
        ].includes(key)
          ? ''
          : key,
      ),
      i18n: { language: 'en-US' },
    } as unknown as ReturnType<typeof i18n.useTranslation>)

    await renderModal(
      <ModerationSettingModal open data={defaultData} onOpenChange={vi.fn()} onSave={onSave} />,
    )

    const textarea = screen.getAllByRole('textbox')[0]
    expect(textarea)!.toHaveAttribute('placeholder', '')
    useTranslationSpy.mockRestore()
  })
})

it('starts with saved moderation values after cancelling a mounted draft', async () => {
  const user = userEvent.setup()
  const onSave = vi.fn()
  const onOpenChange = vi.fn()
  const view = render(
    <ModerationSettingModal open data={defaultData} onSave={onSave} onOpenChange={onOpenChange} />,
  )
  const keywords = screen.getByRole('textbox', {
    name: 'appDebug.feature.moderation.modal.provider.keywords',
  })
  await user.clear(keywords)
  await user.type(keywords, 'discarded')
  await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
  expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything())
  view.rerender(
    <ModerationSettingModal
      open={false}
      data={defaultData}
      onSave={onSave}
      onOpenChange={onOpenChange}
    />,
  )
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  view.rerender(
    <ModerationSettingModal open data={defaultData} onSave={onSave} onOpenChange={onOpenChange} />,
  )
  expect(
    screen.getByRole('textbox', { name: 'appDebug.feature.moderation.modal.provider.keywords' }),
  ).toHaveValue('bad\nword')
  expect(onSave).not.toHaveBeenCalled()
})
