import type { ProviderWithModelsResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { ComponentProps } from 'react'
import type { DefaultModel } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { SummaryIndexSetting } from '@/models/datasets'
import type { RetrievalConfig } from '@/types/app'
import { screen } from '@testing-library/react'
import {
  ConfigurationMethodEnum,
  ModelStatusEnum,
  ModelTypeEnum,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import { ChunkingMode } from '@/models/datasets'
import { consoleQuery } from '@/service/console'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { createNuqsTestRenderer } from '@/test/nuqs-testing'
import { RETRIEVE_METHOD } from '@/types/app'
import { IndexingType } from '../../../../create/step-two'
import IndexingSection from '../indexing-section'

const render = createNuqsTestRenderer(
  (ui, options: Parameters<typeof renderWithConsoleQuery>[1] = {}) => {
    const queryClient = createConsoleQueryClient()
    seedModelProviderQueries(queryClient)
    queryClient.setQueryData(consoleQuery.datasets.retrievalSetting.get.queryKey(), {
      retrieval_method: ['semantic_search', 'full_text_search', 'hybrid_search'],
    })
    return renderWithConsoleQuery(ui, { ...options, queryClient })
  },
)

describe('IndexingSection', () => {
  const mockRetrievalConfig: RetrievalConfig = {
    search_method: RETRIEVE_METHOD.semantic,
    reranking_enable: false,
    reranking_model: {
      reranking_provider_name: '',
      reranking_model_name: '',
    },
    top_k: 3,
    score_threshold_enabled: false,
    score_threshold: 0.5,
  }

  const mockDataset = createDatasetFixture()

  const mockEmbeddingModel: DefaultModel = {
    provider: 'openai',
    model: 'text-embedding-ada-002',
  }

  const mockEmbeddingModelList: ProviderWithModelsResponse[] = [
    {
      tenant_id: 'test-workspace',
      provider: 'openai',
      label: { en_US: 'OpenAI', zh_Hans: 'OpenAI' },
      icon_small: { en_US: '', zh_Hans: '' },
      status: ModelStatusEnum.active,
      models: [
        {
          model: 'text-embedding-ada-002',
          label: { en_US: 'text-embedding-ada-002', zh_Hans: 'text-embedding-ada-002' },
          model_type: ModelTypeEnum.textEmbedding,
          features: [],
          fetch_from: ConfigurationMethodEnum.predefinedModel,
          model_properties: {},
          deprecated: false,
          status: ModelStatusEnum.active,
          load_balancing_enabled: false,
        },
      ],
    },
  ]

  const mockSummaryIndexSetting: SummaryIndexSetting = {
    enable: false,
  }

  const defaultProps: ComponentProps<typeof IndexingSection> = {
    currentDataset: mockDataset,
    indexMethod: IndexingType.QUALIFIED,
    setIndexMethod: vi.fn(),
    keywordNumber: 10,
    setKeywordNumber: vi.fn(),
    embeddingModel: mockEmbeddingModel,
    setEmbeddingModel: vi.fn(),
    embeddingModelList: mockEmbeddingModelList,
    retrievalConfig: mockRetrievalConfig,
    setRetrievalConfig: vi.fn(),
    summaryIndexSetting: mockSummaryIndexSetting,
    handleSummaryIndexSettingChange: vi.fn(),
    showMultiModalTip: false,
  }

  const renderComponent = (props: Partial<typeof defaultProps> = {}) => {
    return render(<IndexingSection {...defaultProps} {...props} />)
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([
    [ChunkingMode.text, IndexingType.QUALIFIED, true, true],
    [ChunkingMode.parentChild, IndexingType.QUALIFIED, false, true],
    [ChunkingMode.text, IndexingType.ECONOMICAL, true, false],
  ])(
    'offers appropriate indexing and embedding controls for %s / %s',
    (docForm, indexMethod, showIndex, showEmbedding) => {
      renderComponent({ currentDataset: { ...mockDataset, doc_form: docForm }, indexMethod })
      expect(!!screen.queryByRole('radiogroup', { name: 'datasetSettings.form.indexMethod' })).toBe(
        showIndex,
      )
      expect(!!screen.queryByRole('button', { name: /datasetSettings.form.embeddingModel/ })).toBe(
        showEmbedding,
      )
      expect(
        !!screen.queryByRole('radio', { name: 'dataset.retrieval.semantic_search.title' }),
      ).toBe(showEmbedding)
      expect(
        !!screen.queryByRole('radio', { name: 'dataset.retrieval.keyword_search.title' }),
      ).toBe(!showEmbedding)
    },
  )

  it('warns that upgrading economy indexing to high quality changes the index', () => {
    renderComponent({
      currentDataset: { ...mockDataset, indexing_technique: IndexingType.ECONOMICAL },
    })
    expect(screen.getByText('datasetSettings.form.upgradeHighQualityTip')).toBeInTheDocument()
  })

  it.each([{ readonly: true }, { currentDataset: { ...mockDataset, embedding_available: false } }])(
    'disables indexing changes when settings cannot be edited',
    (props) => {
      renderComponent(props)
      expect(
        screen.getByRole('radio', { name: /datasetCreation.stepTwo.qualified/ }),
      ).toBeDisabled()
    },
  )

  it('withholds internal retrieval configuration for external datasets', () => {
    renderComponent({ currentDataset: { ...mockDataset, provider: 'external' } })
    expect(
      screen.queryByRole('radio', { name: 'dataset.retrieval.semantic_search.title' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('radio', { name: 'dataset.retrieval.keyword_search.title' }),
    ).not.toBeInTheDocument()
  })

  it.each([
    [ChunkingMode.text, IndexingType.QUALIFIED, true],
    [ChunkingMode.parentChild, IndexingType.QUALIFIED, true],
    [ChunkingMode.qa, IndexingType.QUALIFIED, false],
    [ChunkingMode.text, IndexingType.ECONOMICAL, false],
  ])(
    'limits summary indexing to eligible chunking and indexing combinations: %s / %s',
    (docForm, indexMethod, visible) => {
      render(
        <IndexingSection
          {...defaultProps}
          currentDataset={{ ...mockDataset, doc_form: docForm }}
          indexMethod={indexMethod}
        />,
        { systemFeatures: { deployment_edition: 'COMMUNITY' } },
      )
      expect(!!screen.queryByRole('switch', { name: 'datasetSettings.form.summaryAutoGen' })).toBe(
        visible,
      )
    },
  )
})
