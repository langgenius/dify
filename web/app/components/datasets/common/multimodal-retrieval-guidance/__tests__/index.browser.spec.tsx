import type { ProviderWithModelsResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import {
  ConfigurationMethodEnum,
  ModelFeatureEnum,
  ModelStatusEnum,
  ModelTypeEnum,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import { MultimodalRetrievalGuidance, MultimodalRetrievalGuidanceLearnMore } from '../index'
import { MULTIMODAL_RETRIEVAL_GUIDANCE_DISMISSED_STORAGE_KEY } from '../storage'

const createEmbeddingModelProvider = (
  features: ModelFeatureEnum[] = [],
): ProviderWithModelsResponse => ({
  tenant_id: 'test-workspace',
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

const embeddingModel = { provider: 'test-provider', model: 'test-embedding' }

beforeEach(() => localStorage.clear())

it('keeps help available while dismissal persists across guidance variants', async () => {
  const screen = await render(
    <>
      <MultimodalRetrievalGuidanceLearnMore />
      <MultimodalRetrievalGuidance
        variant="pipeline"
        embeddingModel={embeddingModel}
        embeddingModelList={[createEmbeddingModelProvider()]}
      />
    </>,
  )

  const help = screen.getByRole('link', {
    name: 'datasetSettings.form.multimodalRetrievalGuidance.helpLink',
  })
  await expect
    .element(help)
    .toHaveAttribute(
      'href',
      'https://dify.ai/blog/multimodal-retrieval-is-now-available-in-the-knowledge-base',
    )
  await expect
    .element(screen.getByText('datasetSettings.form.multimodalRetrievalGuidance.pipelineTitle'))
    .toBeVisible()

  help.element().focus()
  await userEvent.tab()
  const dismiss = screen.getByRole('button', {
    name: 'datasetSettings.form.multimodalRetrievalGuidance.dismiss',
  })
  await expect.element(dismiss).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect
    .element(screen.getByText('datasetSettings.form.multimodalRetrievalGuidance.pipelineTitle'))
    .not.toBeInTheDocument()
  expect(localStorage.getItem(MULTIMODAL_RETRIEVAL_GUIDANCE_DISMISSED_STORAGE_KEY)).toBe('true')

  await screen.rerender(
    <>
      <MultimodalRetrievalGuidanceLearnMore />
      <MultimodalRetrievalGuidance
        variant="settings"
        embeddingModel={embeddingModel}
        embeddingModelList={[createEmbeddingModelProvider()]}
      />
    </>,
  )
  await expect
    .element(screen.getByText('datasetSettings.form.multimodalRetrievalGuidance.settingsTitle'))
    .not.toBeInTheDocument()
  await expect.element(help).toBeVisible()
})

it('does not offer guidance for a vision-capable embedding model', async () => {
  const screen = await render(
    <MultimodalRetrievalGuidance
      variant="settings"
      embeddingModel={embeddingModel}
      embeddingModelList={[createEmbeddingModelProvider([ModelFeatureEnum.vision])]}
    />,
  )

  await expect
    .element(screen.getByText('datasetSettings.form.multimodalRetrievalGuidance.settingsTitle'))
    .not.toBeInTheDocument()
})
