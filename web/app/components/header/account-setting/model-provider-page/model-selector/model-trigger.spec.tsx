import type { Model, ModelItem } from '../declarations'
import { fireEvent, render, screen } from '@testing-library/react'
import {
  ConfigurationMethodEnum,
  ModelStatusEnum,
  ModelTypeEnum,
} from '../declarations'
import ModelTrigger from './model-trigger'

vi.mock('../hooks', async () => {
  const actual = await vi.importActual<typeof import('../hooks')>('../hooks')
  return {
    ...actual,
    useLanguage: () => 'en_US',
  }
})

vi.mock('../model-icon', () => ({
  default: ({ modelName }: { modelName: string }) => <span>{modelName}</span>,
}))

vi.mock('../model-name', () => ({
  default: ({ modelItem }: { modelItem: ModelItem }) => <span>{modelItem.label.en_US}</span>,
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

describe('ModelTrigger', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should show model name', () => {
    render(
      <ModelTrigger
        open
        provider={makeModel()}
        model={makeModelItem()}
      />,
    )

    expect(screen.getByText('GPT-4')).toBeInTheDocument()
  })

  it('should show status tooltip content when model is not active', async () => {
    const { container } = render(
      <ModelTrigger
        open={false}
        provider={makeModel()}
        model={makeModelItem({ status: ModelStatusEnum.noConfigure })}
      />,
    )

    const tooltipTrigger = container.querySelector('[data-state]') as HTMLElement
    fireEvent.mouseEnter(tooltipTrigger)

    expect(await screen.findByText('No Configure')).toBeInTheDocument()
  })

  it('should not show status icon when readonly', () => {
    render(
      <ModelTrigger
        open={false}
        provider={makeModel()}
        model={makeModelItem({ status: ModelStatusEnum.noConfigure })}
        readonly
      />,
    )

    expect(screen.getByText('GPT-4')).toBeInTheDocument()
    expect(screen.queryByText('No Configure')).not.toBeInTheDocument()
  })
})
