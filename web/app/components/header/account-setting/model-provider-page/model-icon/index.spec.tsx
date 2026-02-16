import type { Model } from '../declarations'
import { render, screen } from '@testing-library/react'
import { Theme } from '@/types/app'
import {
  ConfigurationMethodEnum,
  ModelStatusEnum,
  ModelTypeEnum,
} from '../declarations'
import ModelIcon from './index'

type I18nText = {
  en_US: string
  zh_Hans: string
}

let mockTheme: Theme = Theme.light
let mockLanguage = 'en_US'

vi.mock('@/hooks/use-theme', () => ({
  default: () => ({ theme: mockTheme }),
}))

vi.mock('../hooks', () => ({
  useLanguage: () => mockLanguage,
}))

vi.mock('@/app/components/base/icons/src/public/llm', () => ({
  OpenaiYellow: () => <svg data-testid="openai-yellow-icon" />,
}))

const createI18nText = (value: string): I18nText => ({
  en_US: value,
  zh_Hans: value,
})

const createModel = (overrides?: Partial<Model>): Model => ({
  provider: 'test-provider',
  icon_small: createI18nText('light.png'),
  icon_small_dark: createI18nText('dark.png'),
  label: createI18nText('Test Provider'),
  models: [
    {
      model: 'test-model',
      label: createI18nText('Test Model'),
      model_type: ModelTypeEnum.textGeneration,
      fetch_from: ConfigurationMethodEnum.predefinedModel,
      status: ModelStatusEnum.active,
      model_properties: {},
      load_balancing_enabled: false,
    },
  ],
  status: ModelStatusEnum.active,
  ...overrides,
})

describe('ModelIcon', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTheme = Theme.light
    mockLanguage = 'en_US'
  })

  // Rendering
  it('should render the light icon when icon_small is provided', () => {
    const provider = createModel({
      icon_small: createI18nText('light-only.png'),
      icon_small_dark: undefined,
    })

    render(<ModelIcon provider={provider} />)

    expect(screen.getByRole('img', { name: /model-icon/i })).toHaveAttribute('src', 'light-only.png')
  })

  // Theme selection
  it('should render the dark icon when theme is dark and icon_small_dark exists', () => {
    mockTheme = Theme.dark
    const provider = createModel({
      icon_small: createI18nText('light.png'),
      icon_small_dark: createI18nText('dark.png'),
    })

    render(<ModelIcon provider={provider} />)

    expect(screen.getByRole('img', { name: /model-icon/i })).toHaveAttribute('src', 'dark.png')
  })

  // Provider override
  it('should ignore icon_small for OpenAI models starting with "o"', () => {
    const provider = createModel({
      provider: 'openai',
      icon_small: createI18nText('openai.png'),
    })

    render(<ModelIcon provider={provider} modelName="o1" />)

    expect(screen.queryByRole('img', { name: /model-icon/i })).not.toBeInTheDocument()
    expect(screen.getByTestId('openai-yellow-icon')).toBeInTheDocument()
  })

  // Edge case
  it('should render without an icon when provider is undefined', () => {
    const { container } = render(<ModelIcon />)

    expect(screen.queryByRole('img', { name: /model-icon/i })).not.toBeInTheDocument()
    expect(container.firstChild).not.toBeNull()
  })
})
