import type { ReactNode } from 'react'
import type { DefaultModel, Model, ModelItem } from '../../declarations'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import {
  ConfigurationMethodEnum,
  ModelStatusEnum,
  ModelTypeEnum,
} from '../../declarations'
import ModelSelector from '../index'

vi.mock('../model-selector-trigger', () => ({
  default: ({
    currentProvider,
    currentModel,
    defaultModel,
  }: { currentProvider?: Model, currentModel?: ModelItem, defaultModel?: DefaultModel }) => {
    if (currentProvider && currentModel)
      return <div>model-trigger</div>

    if (defaultModel)
      return <div>{`deprecated:${defaultModel.model}`}</div>

    return <div>empty-trigger</div>
  },
}))

vi.mock('../popup', () => ({
  default: ({ onHide, onSelect }: { onHide: () => void, onSelect: (provider: string, model: ModelItem) => void }) => (
    <>
      <button type="button" onClick={() => onSelect('openai', { model: 'gpt-4' } as ModelItem)}>
        select
      </button>
      <button type="button" onClick={onHide}>
        hide
      </button>
    </>
  ),
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

const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: { retry: false },
    mutations: { retry: false },
  },
})

const renderWithQueryClient = (node: ReactNode) => {
  const queryClient = createTestQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      {node}
    </QueryClientProvider>,
  )
}

describe('ModelSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should toggle popup and close it after selecting a model', () => {
    renderWithQueryClient(<ModelSelector modelList={[makeModel()]} />)

    const triggerButton = screen.getByRole('button', { name: 'empty-trigger' })

    fireEvent.click(triggerButton)
    expect(triggerButton).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('select')).toBeInTheDocument()

    fireEvent.click(screen.getByText('select'))
    expect(triggerButton).toHaveAttribute('aria-expanded', 'false')
  })

  it('should call onSelect when provided', () => {
    const onSelect = vi.fn()
    renderWithQueryClient(<ModelSelector modelList={[makeModel()]} onSelect={onSelect} />)

    fireEvent.click(screen.getByText('empty-trigger'))
    fireEvent.click(screen.getByText('select'))

    expect(onSelect).toHaveBeenCalledWith({ provider: 'openai', model: 'gpt-4' })
  })

  it('should close popup when popup requests hide', () => {
    renderWithQueryClient(<ModelSelector modelList={[makeModel()]} />)

    const triggerButton = screen.getByRole('button', { name: 'empty-trigger' })
    fireEvent.click(triggerButton)
    expect(triggerButton).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('hide')).toBeInTheDocument()

    fireEvent.click(screen.getByText('hide'))
    expect(triggerButton).toHaveAttribute('aria-expanded', 'false')
  })

  it('should not open popup when readonly', () => {
    renderWithQueryClient(<ModelSelector modelList={[makeModel()]} readonly />)

    fireEvent.click(screen.getByText('empty-trigger'))
    expect(screen.queryByText('select')).not.toBeInTheDocument()
  })

  it('should render deprecated trigger when defaultModel is not in list', () => {
    const { unmount } = renderWithQueryClient(
      <ModelSelector
        defaultModel={{ provider: 'openai', model: 'missing-model' }}
        modelList={[makeModel()]}
      />,
    )

    expect(screen.getByText('deprecated:missing-model')).toBeInTheDocument()

    unmount()
    renderWithQueryClient(
      <ModelSelector
        defaultModel={{ provider: '', model: '' }}
        modelList={[makeModel()]}
      />,
    )
    expect(screen.getByText('deprecated:')).toBeInTheDocument()
  })

  it('should render model trigger when defaultModel matches', () => {
    renderWithQueryClient(
      <ModelSelector
        defaultModel={{ provider: 'openai', model: 'gpt-4' }}
        modelList={[makeModel()]}
      />,
    )

    expect(screen.getByText('model-trigger')).toBeInTheDocument()
  })
})
