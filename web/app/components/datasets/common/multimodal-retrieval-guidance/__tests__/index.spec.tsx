import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  ConfigurationMethodEnum,
  ModelFeatureEnum,
  ModelStatusEnum,
  ModelTypeEnum,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import { MultimodalRetrievalGuidance, MultimodalRetrievalGuidanceLearnMore } from '../index'
import { MULTIMODAL_RETRIEVAL_GUIDANCE_DISMISSED_STORAGE_KEY } from '../storage'

const createEmbeddingModelProvider = (features: ModelFeatureEnum[] = []) => ({
  provider: 'test-provider',
  icon_small: { en_US: '', zh_Hans: '' },
  label: { en_US: 'Test Provider', zh_Hans: 'Test Provider' },
  status: ModelStatusEnum.active,
  models: [
    {
      model: 'test-embedding',
      label: { en_US: 'Test Embedding', zh_Hans: 'Test Embedding' },
      model_type: ModelTypeEnum.textEmbedding,
      features,
      fetch_from: ConfigurationMethodEnum.predefinedModel,
      status: ModelStatusEnum.active,
      model_properties: {},
      load_balancing_enabled: false,
    },
  ],
})

describe('MultimodalRetrievalGuidance', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('should render the variant copy and help link when the embedding model does not support vision', () => {
    render(
      <>
        <MultimodalRetrievalGuidanceLearnMore />
        <MultimodalRetrievalGuidance
          variant="pipeline"
          embeddingModel={{ provider: 'test-provider', model: 'test-embedding' }}
          embeddingModelList={[createEmbeddingModelProvider()]}
        />
      </>,
    )

    expect(
      screen.getByText('datasetSettings.form.multimodalRetrievalGuidance.pipelineTitle'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('datasetSettings.form.multimodalRetrievalGuidance.pipelineDescription'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', {
        name: 'datasetSettings.form.multimodalRetrievalGuidance.helpLink',
      }),
    ).toHaveAttribute(
      'href',
      'https://dify.ai/blog/multimodal-retrieval-is-now-available-in-the-knowledge-base',
    )
    expect(
      screen.getByText('datasetSettings.form.multimodalRetrievalGuidance.helpDescription'),
    ).toBeInTheDocument()
  })

  it('should stay hidden when the embedding model supports vision', () => {
    render(
      <MultimodalRetrievalGuidance
        variant="settings"
        embeddingModel={{ provider: 'test-provider', model: 'test-embedding' }}
        embeddingModelList={[createEmbeddingModelProvider([ModelFeatureEnum.vision])]}
      />,
    )

    expect(
      screen.queryByText('datasetSettings.form.multimodalRetrievalGuidance.settingsTitle'),
    ).not.toBeInTheDocument()
  })

  it('should persist dismissal so every variant stays hidden', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <>
        <MultimodalRetrievalGuidanceLearnMore />
        <MultimodalRetrievalGuidance
          variant="create"
          embeddingModel={{ provider: 'test-provider', model: 'test-embedding' }}
          embeddingModelList={[createEmbeddingModelProvider()]}
        />
      </>,
    )

    await user.click(
      screen.getByRole('button', {
        name: 'datasetSettings.form.multimodalRetrievalGuidance.dismiss',
      }),
    )

    expect(localStorage.getItem(MULTIMODAL_RETRIEVAL_GUIDANCE_DISMISSED_STORAGE_KEY)).toBe('true')
    expect(
      screen.getByRole('link', {
        name: 'datasetSettings.form.multimodalRetrievalGuidance.helpLink',
      }),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('datasetSettings.form.multimodalRetrievalGuidance.createTitle'),
    ).not.toBeInTheDocument()

    rerender(
      <>
        <MultimodalRetrievalGuidanceLearnMore />
        <MultimodalRetrievalGuidance
          variant="settings"
          embeddingModel={{ provider: 'test-provider', model: 'test-embedding' }}
          embeddingModelList={[createEmbeddingModelProvider()]}
        />
      </>,
    )
    expect(
      screen.queryByText('datasetSettings.form.multimodalRetrievalGuidance.settingsTitle'),
    ).not.toBeInTheDocument()
  })
})
