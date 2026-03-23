import type { DefaultModel, Model, ModelItem } from '../declarations'
import { fireEvent, render, screen } from '@testing-library/react'
import {
  ConfigurationMethodEnum,
  ModelFeatureEnum,
  ModelStatusEnum,
  ModelTypeEnum,
} from '../declarations'
import PopupItem from './popup-item'

const mockUpdateModelList = vi.hoisted(() => vi.fn())
const mockUpdateModelProviders = vi.hoisted(() => vi.fn())

vi.mock('../hooks', async () => {
  const actual = await vi.importActual<typeof import('../hooks')>('../hooks')
  return {
    ...actual,
    useLanguage: () => 'en_US',
    useUpdateModelList: () => mockUpdateModelList,
    useUpdateModelProviders: () => mockUpdateModelProviders,
  }
})

vi.mock('../model-badge', () => ({
  default: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))

vi.mock('../model-icon', () => ({
  default: ({ modelName }: { modelName: string }) => <span>{modelName}</span>,
}))

vi.mock('../model-name', () => ({
  default: ({ modelItem }: { modelItem: ModelItem }) => <span>{modelItem.label.en_US}</span>,
}))

const mockSetShowModelModal = vi.hoisted(() => vi.fn())
vi.mock('@/context/modal-context', () => ({
  useModalContext: () => ({
    setShowModelModal: mockSetShowModelModal,
  }),
}))

const mockUseProviderContext = vi.hoisted(() => vi.fn())
vi.mock('@/context/provider-context', () => ({
  useProviderContext: mockUseProviderContext,
}))

const makeModelItem = (overrides: Partial<ModelItem> = {}): ModelItem => ({
  model: 'gpt-4',
  label: { en_US: 'GPT-4', zh_Hans: 'GPT-4' },
  model_type: ModelTypeEnum.textGeneration,
  features: [ModelFeatureEnum.vision],
  fetch_from: ConfigurationMethodEnum.predefinedModel,
  status: ModelStatusEnum.active,
  model_properties: { mode: 'chat', context_size: 4096 },
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

describe('PopupItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseProviderContext.mockReturnValue({
      modelProviders: [{ provider: 'openai' }],
    })
  })

  it('should call onSelect when clicking an active model', () => {
    const onSelect = vi.fn()
    render(<PopupItem model={makeModel()} onSelect={onSelect} />)

    fireEvent.click(screen.getByText('GPT-4'))

    expect(onSelect).toHaveBeenCalledWith('openai', expect.objectContaining({ model: 'gpt-4' }))
  })

  it('should not call onSelect when model is not active', () => {
    const onSelect = vi.fn()
    render(
      <PopupItem
        model={makeModel({ models: [makeModelItem({ status: ModelStatusEnum.disabled })] })}
        onSelect={onSelect}
      />,
    )

    fireEvent.click(screen.getByText('GPT-4'))

    expect(onSelect).not.toHaveBeenCalled()
  })

  it('should open model modal when clicking add on unconfigured model', () => {
    const { rerender } = render(
      <PopupItem
        model={makeModel({ models: [makeModelItem({ status: ModelStatusEnum.noConfigure })] })}
        onSelect={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByText('COMMON.OPERATION.ADD'))

    expect(mockSetShowModelModal).toHaveBeenCalled()

    const call = mockSetShowModelModal.mock.calls[0][0] as { onSaveCallback?: () => void }
    call.onSaveCallback?.()

    expect(mockUpdateModelProviders).toHaveBeenCalled()
    expect(mockUpdateModelList).toHaveBeenCalledWith(ModelTypeEnum.textGeneration)

    rerender(
      <PopupItem
        model={makeModel({
          models: [makeModelItem({ status: ModelStatusEnum.noConfigure, model_type: undefined as unknown as ModelTypeEnum })],
        })}
        onSelect={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByText('COMMON.OPERATION.ADD'))
    const call2 = mockSetShowModelModal.mock.calls.at(-1)?.[0] as { onSaveCallback?: () => void } | undefined
    call2?.onSaveCallback?.()

    expect(mockUpdateModelProviders).toHaveBeenCalled()
    expect(mockUpdateModelList).toHaveBeenCalledTimes(1)
  })

  it('should show selected state when defaultModel matches', () => {
    const defaultModel: DefaultModel = { provider: 'openai', model: 'gpt-4' }
    render(
      <PopupItem
        defaultModel={defaultModel}
        model={makeModel()}
        onSelect={vi.fn()}
      />,
    )

    expect(screen.getByText('GPT-4')).toBeInTheDocument()
  })
})
