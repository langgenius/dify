import type { ModelItem } from '../declarations'
import { render, screen } from '@testing-library/react'
import {
  ConfigurationMethodEnum,
  ModelFeatureEnum,
  ModelStatusEnum,
  ModelTypeEnum,
} from '../declarations'
import ModelName from './index'

let mockLocale = 'en-US'

vi.mock('#i18n', () => ({
  useTranslation: () => ({
    i18n: {
      language: mockLocale,
    },
  }),
}))

const createModelItem = (overrides: Partial<ModelItem> = {}): ModelItem => ({
  model: 'gpt-4o',
  label: {
    en_US: 'English Model',
    zh_Hans: 'Chinese Model',
  },
  model_type: ModelTypeEnum.textGeneration,
  features: [],
  fetch_from: ConfigurationMethodEnum.predefinedModel,
  status: ModelStatusEnum.active,
  model_properties: {},
  load_balancing_enabled: false,
  ...overrides,
})

describe('ModelName', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLocale = 'en-US'
  })

  // Rendering scenarios for the model name label.
  describe('rendering', () => {
    it('should render the localized model label when translation exists', () => {
      mockLocale = 'zh-Hans'
      const modelItem = createModelItem()

      render(<ModelName modelItem={modelItem} />)

      expect(screen.getByText('Chinese Model')).toBeInTheDocument()
    })

    it('should fall back to en_US label when localized label is missing', () => {
      mockLocale = 'fr-FR'
      const modelItem = createModelItem({
        label: {
          en_US: 'English Only',
          zh_Hans: 'Chinese Model',
        },
      })

      render(<ModelName modelItem={modelItem} />)

      expect(screen.getByText('English Only')).toBeInTheDocument()
    })

    it('should render nothing when modelItem is null', () => {
      const { container } = render(<ModelName modelItem={null as unknown as ModelItem} />)

      expect(container).toBeEmptyDOMElement()
    })
  })

  // Badges that surface model metadata to the user.
  describe('badges', () => {
    it('should show model type, mode, and context size when enabled', () => {
      const modelItem = createModelItem({
        model_type: ModelTypeEnum.textEmbedding,
        model_properties: {
          mode: 'chat',
          context_size: 2000,
        },
      })

      render(
        <ModelName
          modelItem={modelItem}
          showModelType
          showMode
          showContextSize
        />,
      )

      expect(screen.getByText('TEXT EMBEDDING')).toBeInTheDocument()
      expect(screen.getByText('CHAT')).toBeInTheDocument()
      expect(screen.getByText('2K')).toBeInTheDocument()
    })

    it('should render feature labels when showFeaturesLabel is enabled', () => {
      const modelItem = createModelItem({
        features: [ModelFeatureEnum.vision, ModelFeatureEnum.audio],
      })

      render(
        <ModelName
          modelItem={modelItem}
          showFeatures
          showFeaturesLabel
        />,
      )

      expect(screen.getByText('Vision')).toBeInTheDocument()
      expect(screen.getByText('Audio')).toBeInTheDocument()
    })
  })
})
