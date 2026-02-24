import type { ModerationConfig } from '@/models/debug'
import { fireEvent, render, screen } from '@testing-library/react'
import ModerationSettingModal from './moderation-setting-modal'

const mockNotify = vi.fn()
vi.mock('@/app/components/base/toast', () => ({
  useToastContext: () => ({ notify: mockNotify }),
}))

const mockSetShowAccountSettingModal = vi.fn()
vi.mock('@/context/modal-context', () => ({
  useModalContext: () => ({
    setShowAccountSettingModal: mockSetShowAccountSettingModal,
  }),
}))

let mockCodeBasedExtensions: { data: { data: Record<string, unknown>[] } } = { data: { data: [] } }
let mockModelProvidersData: {
  data: { data: Record<string, unknown>[] }
  isPending: boolean
  refetch: ReturnType<typeof vi.fn>
} = {
  data: {
    data: [{
      provider: 'langgenius/openai/openai',
      system_configuration: {
        enabled: true,
        current_quota_type: 'paid',
        quota_configurations: [{ quota_type: 'paid', is_valid: true }],
      },
      custom_configuration: { status: 'active' },
    }],
  },
  isPending: false,
  refetch: vi.fn(),
}

vi.mock('@/service/use-common', () => ({
  useCodeBasedExtensions: () => mockCodeBasedExtensions,
  useModelProviders: () => mockModelProvidersData,
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/declarations', () => ({
  CustomConfigurationStatusEnum: { active: 'active' },
}))

vi.mock('@/app/components/header/account-setting/constants', () => ({
  ACCOUNT_SETTING_TAB: { PROVIDER: 'provider' },
}))

vi.mock('@/app/components/header/account-setting/api-based-extension-page/selector', () => ({
  default: ({ onChange }: { value: string, onChange: (v: string) => void }) => (
    <div data-testid="api-selector">
      <button data-testid="select-api" onClick={() => onChange('api-ext-1')}>Select API</button>
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
  beforeEach(() => {
    vi.clearAllMocks()
    mockCodeBasedExtensions = { data: { data: [] } }
    mockModelProvidersData = {
      data: {
        data: [{
          provider: 'langgenius/openai/openai',
          system_configuration: {
            enabled: true,
            current_quota_type: 'paid',
            quota_configurations: [{ quota_type: 'paid', is_valid: true }],
          },
          custom_configuration: { status: 'active' },
        }],
      },
      isPending: false,
      refetch: vi.fn(),
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should render the modal title', async () => {
    await render(
      <ModerationSettingModal
        data={defaultData}
        onCancel={vi.fn()}
        onSave={onSave}
      />,
    )

    expect(screen.getByText(/feature\.moderation\.modal\.title/)).toBeInTheDocument()
  })

  it('should render provider options', async () => {
    await render(
      <ModerationSettingModal
        data={defaultData}
        onCancel={vi.fn()}
        onSave={onSave}
      />,
    )

    expect(screen.getByText(/feature\.moderation\.modal\.provider\.openai/)).toBeInTheDocument()
    // Keywords text appears both as provider option and section label
    expect(screen.getAllByText(/feature\.moderation\.modal\.provider\.keywords/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/apiBasedExtension\.selector\.title/)).toBeInTheDocument()
  })

  it('should show keywords textarea when keywords type is selected', async () => {
    await render(
      <ModerationSettingModal
        data={defaultData}
        onCancel={vi.fn()}
        onSave={onSave}
      />,
    )

    const textarea = screen.getByPlaceholderText(/feature\.moderation\.modal\.keywords\.placeholder/) as HTMLTextAreaElement
    expect(textarea).toBeInTheDocument()
    expect(textarea).toHaveValue('bad\nword')
  })

  it('should render cancel and save buttons', async () => {
    await render(
      <ModerationSettingModal
        data={defaultData}
        onCancel={vi.fn()}
        onSave={onSave}
      />,
    )

    expect(screen.getByText(/operation\.cancel/)).toBeInTheDocument()
    expect(screen.getByText(/operation\.save/)).toBeInTheDocument()
  })

  it('should call onCancel when cancel is clicked', async () => {
    const onCancel = vi.fn()
    await render(
      <ModerationSettingModal
        data={defaultData}
        onCancel={onCancel}
        onSave={onSave}
      />,
    )

    fireEvent.click(screen.getByText(/operation\.cancel/))

    expect(onCancel).toHaveBeenCalled()
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
    await render(
      <ModerationSettingModal
        data={data}
        onCancel={vi.fn()}
        onSave={onSave}
      />,
    )

    fireEvent.click(screen.getByText(/operation\.save/))

    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error' }),
    )
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
    await render(
      <ModerationSettingModal
        data={data}
        onCancel={vi.fn()}
        onSave={onSave}
      />,
    )

    fireEvent.click(screen.getByText(/operation\.save/))

    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error' }),
    )
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
    await render(
      <ModerationSettingModal
        data={data}
        onCancel={vi.fn()}
        onSave={onSave}
      />,
    )

    fireEvent.click(screen.getByText(/operation\.save/))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      type: 'keywords',
      enabled: true,
      config: expect.objectContaining({
        keywords: 'bad\nword',
        inputs_config: expect.objectContaining({ enabled: true }),
      }),
    }))
  })

  it('should show api selector when api type is selected', async () => {
    await render(
      <ModerationSettingModal
        data={{ ...defaultData, type: 'api', config: { inputs_config: { enabled: true, preset_response: '' } } }}
        onCancel={vi.fn()}
        onSave={onSave}
      />,
    )

    expect(screen.getByTestId('api-selector')).toBeInTheDocument()
  })

  it('should switch provider type when clicked', async () => {
    await render(
      <ModerationSettingModal
        data={defaultData}
        onCancel={vi.fn()}
        onSave={onSave}
      />,
    )

    // Click on openai_moderation provider
    fireEvent.click(screen.getByText(/feature\.moderation\.modal\.provider\.openai/))

    // The keywords textarea should no longer be visible since type changed
    expect(screen.queryByPlaceholderText(/feature\.moderation\.modal\.keywords\.placeholder/)).not.toBeInTheDocument()
  })

  it('should update keywords on textarea change', async () => {
    await render(
      <ModerationSettingModal
        data={defaultData}
        onCancel={vi.fn()}
        onSave={onSave}
      />,
    )

    const textarea = screen.getByPlaceholderText(/feature\.moderation\.modal\.keywords\.placeholder/) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'new\nkeywords' } })

    expect(textarea).toHaveValue('new\nkeywords')
  })

  it('should render moderation content sections', async () => {
    await render(
      <ModerationSettingModal
        data={defaultData}
        onCancel={vi.fn()}
        onSave={onSave}
      />,
    )

    expect(screen.getByText(/feature\.moderation\.modal\.content\.input/)).toBeInTheDocument()
    expect(screen.getByText(/feature\.moderation\.modal\.content\.output/)).toBeInTheDocument()
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
    await render(
      <ModerationSettingModal
        data={data}
        onCancel={vi.fn()}
        onSave={onSave}
      />,
    )

    fireEvent.click(screen.getByText(/operation\.save/))

    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error' }),
    )
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
    await render(
      <ModerationSettingModal
        data={data}
        onCancel={vi.fn()}
        onSave={onSave}
      />,
    )

    fireEvent.click(screen.getByText(/operation\.save/))

    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error' }),
    )
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
    await render(
      <ModerationSettingModal
        data={data}
        onCancel={vi.fn()}
        onSave={onSave}
      />,
    )

    // api type doesn't require preset_response, so save should succeed
    fireEvent.click(screen.getByText(/operation\.save/))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      type: 'api',
      config: expect.objectContaining({
        api_based_extension_id: 'ext-1',
      }),
    }))
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
    await render(
      <ModerationSettingModal
        data={data}
        onCancel={vi.fn()}
        onSave={onSave}
      />,
    )

    fireEvent.click(screen.getByText(/operation\.save/))

    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error' }),
    )
  })

  it('should toggle input moderation content', async () => {
    await render(
      <ModerationSettingModal
        data={defaultData}
        onCancel={vi.fn()}
        onSave={onSave}
      />,
    )

    const switches = screen.getAllByRole('switch')
    expect(screen.getAllByPlaceholderText(/feature\.moderation\.modal\.content\.placeholder/)).toHaveLength(1)

    fireEvent.click(switches[0])

    expect(screen.queryAllByPlaceholderText(/feature\.moderation\.modal\.content\.placeholder/)).toHaveLength(0)
  })

  it('should toggle output moderation content', async () => {
    await render(
      <ModerationSettingModal
        data={defaultData}
        onCancel={vi.fn()}
        onSave={onSave}
      />,
    )

    const switches = screen.getAllByRole('switch')
    expect(screen.getAllByPlaceholderText(/feature\.moderation\.modal\.content\.placeholder/)).toHaveLength(1)

    fireEvent.click(switches[1])

    expect(screen.getAllByPlaceholderText(/feature\.moderation\.modal\.content\.placeholder/)).toHaveLength(2)
  })

  it('should select api extension via api selector', async () => {
    await render(
      <ModerationSettingModal
        data={{ ...defaultData, type: 'api', config: { inputs_config: { enabled: true, preset_response: '' } } }}
        onCancel={vi.fn()}
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
    await render(
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

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      type: 'openai_moderation',
    }))
  })

  it('should handle keyword truncation to 100 chars per line and 100 lines', async () => {
    await render(
      <ModerationSettingModal
        data={defaultData}
        onCancel={vi.fn()}
        onSave={onSave}
      />,
    )

    const textarea = screen.getByPlaceholderText(/feature\.moderation\.modal\.keywords\.placeholder/)
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
    await render(
      <ModerationSettingModal
        data={data}
        onCancel={vi.fn()}
        onSave={onSave}
      />,
    )

    fireEvent.click(screen.getByText(/operation\.save/))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({
        inputs_config: expect.objectContaining({ enabled: true }),
        outputs_config: expect.objectContaining({ enabled: true }),
      }),
    }))
  })

  it('should switch from keywords to api type', async () => {
    await render(
      <ModerationSettingModal
        data={defaultData}
        onCancel={vi.fn()}
        onSave={onSave}
      />,
    )

    // Click api provider
    fireEvent.click(screen.getByText(/apiBasedExtension\.selector\.title/))

    // API selector should now be visible, keywords textarea should be hidden
    expect(screen.getByTestId('api-selector')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/feature\.moderation\.modal\.keywords\.placeholder/)).not.toBeInTheDocument()
  })

  it('should handle empty lines in keywords', async () => {
    await render(
      <ModerationSettingModal
        data={defaultData}
        onCancel={vi.fn()}
        onSave={onSave}
      />,
    )

    const textarea = screen.getByPlaceholderText(/feature\.moderation\.modal\.keywords\.placeholder/) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'word1\n\nword2\n\n' } })

    expect(textarea.value).toBe('word1\n\nword2\n')
  })

  it('should show OpenAI not configured warning when OpenAI provider is not set up', async () => {
    mockModelProvidersData = {
      data: {
        data: [{
          provider: 'langgenius/openai/openai',
          system_configuration: {
            enabled: false,
            current_quota_type: 'free',
            quota_configurations: [],
          },
          custom_configuration: { status: 'no-configure' },
        }],
      },
      isPending: false,
      refetch: vi.fn(),
    }

    await render(
      <ModerationSettingModal
        data={{ ...defaultData, type: 'openai_moderation', config: { inputs_config: { enabled: true, preset_response: '' } } }}
        onCancel={vi.fn()}
        onSave={onSave}
      />,
    )

    expect(screen.getByText(/feature\.moderation\.modal\.openaiNotConfig\.before/)).toBeInTheDocument()
  })

  it('should open settings modal when provider link is clicked in OpenAI warning', async () => {
    mockModelProvidersData = {
      data: {
        data: [{
          provider: 'langgenius/openai/openai',
          system_configuration: {
            enabled: false,
            current_quota_type: 'free',
            quota_configurations: [],
          },
          custom_configuration: { status: 'no-configure' },
        }],
      },
      isPending: false,
      refetch: vi.fn(),
    }

    await render(
      <ModerationSettingModal
        data={{ ...defaultData, type: 'openai_moderation', config: { inputs_config: { enabled: true, preset_response: '' } } }}
        onCancel={vi.fn()}
        onSave={onSave}
      />,
    )

    fireEvent.click(screen.getByText(/settings\.provider/))

    expect(mockSetShowAccountSettingModal).toHaveBeenCalled()
  })

  it('should not save when OpenAI type is selected but not configured', async () => {
    mockModelProvidersData = {
      data: {
        data: [{
          provider: 'langgenius/openai/openai',
          system_configuration: {
            enabled: false,
            current_quota_type: 'free',
            quota_configurations: [],
          },
          custom_configuration: { status: 'no-configure' },
        }],
      },
      isPending: false,
      refetch: vi.fn(),
    }

    await render(
      <ModerationSettingModal
        data={{ ...defaultData, type: 'openai_moderation', config: { inputs_config: { enabled: true, preset_response: 'blocked' }, outputs_config: { enabled: false, preset_response: '' } } }}
        onCancel={vi.fn()}
        onSave={onSave}
      />,
    )

    fireEvent.click(screen.getByText(/operation\.save/))

    expect(onSave).not.toHaveBeenCalled()
  })

  it('should render code-based extension providers', async () => {
    mockCodeBasedExtensions = {
      data: {
        data: [{
          name: 'custom-ext',
          label: { 'en-US': 'Custom Extension', 'zh-Hans': '自定义扩展' },
          form_schema: [
            { variable: 'api_url', label: { 'en-US': 'API URL', 'zh-Hans': 'API 地址' }, type: 'text-input', required: true, default: '', placeholder: 'Enter URL', options: [], max_length: 200 },
          ],
        }],
      },
    }

    await render(
      <ModerationSettingModal
        data={defaultData}
        onCancel={vi.fn()}
        onSave={onSave}
      />,
    )

    expect(screen.getByText('Custom Extension')).toBeInTheDocument()
  })

  it('should show form generation when code-based extension is selected', async () => {
    mockCodeBasedExtensions = {
      data: {
        data: [{
          name: 'custom-ext',
          label: { 'en-US': 'Custom Extension', 'zh-Hans': '自定义扩展' },
          form_schema: [
            { variable: 'api_url', label: { 'en-US': 'API URL', 'zh-Hans': 'API 地址' }, type: 'text-input', required: true, default: '', placeholder: 'Enter URL', options: [], max_length: 200 },
          ],
        }],
      },
    }

    await render(
      <ModerationSettingModal
        data={{ ...defaultData, type: 'custom-ext', config: { inputs_config: { enabled: true, preset_response: '' } } }}
        onCancel={vi.fn()}
        onSave={onSave}
      />,
    )

    expect(screen.getByText('API URL')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Enter URL')).toBeInTheDocument()
  })

  it('should initialize config from form schema when switching to code-based extension', async () => {
    mockCodeBasedExtensions = {
      data: {
        data: [{
          name: 'custom-ext',
          label: { 'en-US': 'Custom Extension', 'zh-Hans': '自定义扩展' },
          form_schema: [
            { variable: 'api_url', label: { 'en-US': 'API URL', 'zh-Hans': 'API 地址' }, type: 'text-input', required: true, default: 'https://default.com', placeholder: '', options: [], max_length: 200 },
          ],
        }],
      },
    }

    await render(
      <ModerationSettingModal
        data={defaultData}
        onCancel={vi.fn()}
        onSave={onSave}
      />,
    )

    // Click on the custom extension provider
    fireEvent.click(screen.getByText('Custom Extension'))

    // The form input should use the default value from form schema
    expect(screen.getByDisplayValue('https://default.com')).toBeInTheDocument()
  })

  it('should show error when required form schema field is empty on save', async () => {
    mockCodeBasedExtensions = {
      data: {
        data: [{
          name: 'custom-ext',
          label: { 'en-US': 'Custom Extension', 'zh-Hans': '自定义扩展' },
          form_schema: [
            { variable: 'api_url', label: { 'en-US': 'API URL', 'zh-Hans': 'API 地址' }, type: 'text-input', required: true, default: '', placeholder: '', options: [], max_length: 200 },
          ],
        }],
      },
    }

    await render(
      <ModerationSettingModal
        data={{ ...defaultData, type: 'custom-ext', config: { inputs_config: { enabled: true, preset_response: 'blocked' } } }}
        onCancel={vi.fn()}
        onSave={onSave}
      />,
    )

    fireEvent.click(screen.getByText(/operation\.save/))

    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error' }),
    )
  })

  it('should save with code-based extension config when valid', async () => {
    mockCodeBasedExtensions = {
      data: {
        data: [{
          name: 'custom-ext',
          label: { 'en-US': 'Custom Extension', 'zh-Hans': '自定义扩展' },
          form_schema: [
            { variable: 'api_url', label: { 'en-US': 'API URL', 'zh-Hans': 'API 地址' }, type: 'text-input', required: true, default: '', placeholder: '', options: [], max_length: 200 },
          ],
        }],
      },
    }

    await render(
      <ModerationSettingModal
        data={{ ...defaultData, type: 'custom-ext', config: { api_url: 'https://example.com', inputs_config: { enabled: true, preset_response: 'blocked' }, outputs_config: { enabled: false, preset_response: '' } } }}
        onCancel={vi.fn()}
        onSave={onSave}
      />,
    )

    fireEvent.click(screen.getByText(/operation\.save/))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      type: 'custom-ext',
      config: expect.objectContaining({
        api_url: 'https://example.com',
      }),
    }))
  })

  it('should show doc link for api type', async () => {
    await render(
      <ModerationSettingModal
        data={{ ...defaultData, type: 'api', config: { inputs_config: { enabled: true, preset_response: '' } } }}
        onCancel={vi.fn()}
        onSave={onSave}
      />,
    )

    expect(screen.getByText(/apiBasedExtension\.link/)).toBeInTheDocument()
  })
})
