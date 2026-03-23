import type { Model, ModelItem } from '../declarations'
import { fireEvent, render, screen } from '@testing-library/react'
import {
  ConfigurationMethodEnum,
  ModelFeatureEnum,
  ModelStatusEnum,
  ModelTypeEnum,
} from '../declarations'
import Popup from './popup'

let mockLanguage = 'en_US'

const mockSetShowAccountSettingModal = vi.hoisted(() => vi.fn())
vi.mock('@/context/modal-context', () => ({
  useModalContext: () => ({
    setShowAccountSettingModal: mockSetShowAccountSettingModal,
  }),
}))

const mockSupportFunctionCall = vi.hoisted(() => vi.fn())
vi.mock('@/utils/tool-call', () => ({
  supportFunctionCall: mockSupportFunctionCall,
}))

const mockCloseActiveTooltip = vi.hoisted(() => vi.fn())
vi.mock('@/app/components/base/tooltip/TooltipManager', () => ({
  tooltipManager: {
    closeActiveTooltip: mockCloseActiveTooltip,
    register: vi.fn(),
    clear: vi.fn(),
  },
}))

vi.mock('@/app/components/base/icons/src/vender/solid/general', () => ({
  XCircle: ({ onClick }: { onClick?: () => void }) => (
    <button type="button" aria-label="clear-search" onClick={onClick} />
  ),
}))

vi.mock('../hooks', async () => {
  const actual = await vi.importActual<typeof import('../hooks')>('../hooks')
  return {
    ...actual,
    useLanguage: () => mockLanguage,
  }
})

vi.mock('./popup-item', () => ({
  default: ({ model }: { model: Model }) => <div>{model.provider}</div>,
}))

const makeModelItem = (overrides: Partial<ModelItem> = {}): ModelItem => ({
  model: 'gpt-4',
  label: { en_US: 'GPT-4', zh_Hans: 'GPT-4' },
  model_type: ModelTypeEnum.textGeneration,
  fetch_from: ConfigurationMethodEnum.predefinedModel,
  status: ModelStatusEnum.active,
  model_properties: {},
  load_balancing_enabled: false,
  ...overrides,
})

const makeModel = (overrides: Partial<Model> = {}): Model => ({
  provider: 'openai',
  icon_small: { en_US: '', zh_Hans: '' },
  label: { en_US: 'OpenAI', zh_Hans: 'OpenAI' },
  models: [makeModelItem()],
  status: ModelStatusEnum.active,
  ...overrides,
})

describe('Popup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLanguage = 'en_US'
    mockSupportFunctionCall.mockReturnValue(true)
  })

  it('should filter models by search and allow clearing search', () => {
    render(
      <Popup
        modelList={[makeModel()]}
        onSelect={vi.fn()}
        onHide={vi.fn()}
      />,
    )

    expect(screen.getByText('openai')).toBeInTheDocument()

    const input = screen.getByPlaceholderText('datasetSettings.form.searchModel')
    fireEvent.change(input, { target: { value: 'not-found' } })
    expect(screen.getByText('No model found for “not-found”')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'clear-search' }))
    expect((input as HTMLInputElement).value).toBe('')
  })

  it('should filter by scope features including toolCall and non-toolCall checks', () => {
    const modelList = [
      makeModel({ models: [makeModelItem({ features: [ModelFeatureEnum.toolCall, ModelFeatureEnum.vision] })] }),
    ]

    // When tool-call support is missing, it should be filtered out.
    mockSupportFunctionCall.mockReturnValue(false)
    const { unmount } = render(
      <Popup
        modelList={modelList}
        onSelect={vi.fn()}
        onHide={vi.fn()}
        scopeFeatures={[ModelFeatureEnum.toolCall, ModelFeatureEnum.vision]}
      />,
    )
    expect(screen.getByText('No model found for “”')).toBeInTheDocument()

    // When tool-call support exists, the non-toolCall feature check should also pass.
    unmount()
    mockSupportFunctionCall.mockReturnValue(true)
    const { unmount: unmount2 } = render(
      <Popup
        modelList={modelList}
        onSelect={vi.fn()}
        onHide={vi.fn()}
        scopeFeatures={[ModelFeatureEnum.toolCall, ModelFeatureEnum.vision]}
      />,
    )
    expect(screen.getByText('openai')).toBeInTheDocument()

    unmount2()
    const { unmount: unmount3 } = render(
      <Popup
        modelList={modelList}
        onSelect={vi.fn()}
        onHide={vi.fn()}
        scopeFeatures={[ModelFeatureEnum.vision]}
      />,
    )
    expect(screen.getByText('openai')).toBeInTheDocument()

    // When features are missing, non-toolCall feature checks should fail.
    unmount3()
    render(
      <Popup
        modelList={[makeModel({ models: [makeModelItem({ features: undefined })] })]}
        onSelect={vi.fn()}
        onHide={vi.fn()}
        scopeFeatures={[ModelFeatureEnum.vision]}
      />,
    )
    expect(screen.getByText('No model found for “”')).toBeInTheDocument()
  })

  it('should match labels from other languages when current language key is missing', () => {
    mockLanguage = 'fr_FR'

    render(
      <Popup
        modelList={[makeModel()]}
        onSelect={vi.fn()}
        onHide={vi.fn()}
      />,
    )

    fireEvent.change(
      screen.getByPlaceholderText('datasetSettings.form.searchModel'),
      { target: { value: 'gpt' } },
    )

    expect(screen.getByText('openai')).toBeInTheDocument()
  })

  it('should close tooltip on scroll', () => {
    const { container } = render(
      <Popup
        modelList={[makeModel()]}
        onSelect={vi.fn()}
        onHide={vi.fn()}
      />,
    )

    fireEvent.scroll(container.firstElementChild as HTMLElement)
    expect(mockCloseActiveTooltip).toHaveBeenCalled()
  })

  it('should open provider settings when clicking footer link', () => {
    render(
      <Popup
        modelList={[makeModel()]}
        onSelect={vi.fn()}
        onHide={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByText('common.model.settingsLink'))

    expect(mockSetShowAccountSettingModal).toHaveBeenCalledWith({
      payload: 'provider',
    })
  })
})
