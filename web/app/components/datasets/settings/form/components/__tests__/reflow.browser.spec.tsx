import type { DataSet } from '@/models/datasets'
import type { RetrievalConfig } from '@/types/app'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import datasetSettings from '@/i18n/locales/en-US/dataset-settings.json'
import { ChunkingMode, DatasetPermission, DataSourceType } from '@/models/datasets'
import { RETRIEVE_METHOD } from '@/types/app'
import { IndexingType } from '../../../../create/step-two'
import ExternalKnowledgeSection from '../external-knowledge-section'
import IndexingSection from '../indexing-section'

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  const { default: settings } = await import('@/i18n/locales/en-US/dataset-settings.json')
  const { default: creation } = await import('@/i18n/locales/en-US/dataset-creation.json')
  return createReactI18nextMock({ ...settings, ...creation })
})
vi.mock('@/context/i18n', () => ({ useDocLink: () => (path: string) => path }))
vi.mock('@/features/system-features/client', () => ({
  systemFeaturesQueryOptions: () => ({
    queryKey: ['settings-reflow-system-features'],
    queryFn: async () => ({ deployment_edition: 'CLOUD' }),
  }),
}))
// These independently tested controls do not own the warning or external field layout.
vi.mock('@/app/components/datasets/settings/chunk-structure', () => ({ default: () => null }))
vi.mock('@/app/components/datasets/settings/summary-index-setting', () => ({ default: () => null }))
vi.mock('@/app/components/header/account-setting/model-provider-page/model-selector', () => ({
  ModelSelector: () => null,
}))
vi.mock('@/app/components/datasets/common/multimodal-retrieval-guidance', () => ({
  MultimodalRetrievalGuidance: () => null,
  MultimodalRetrievalGuidanceLearnMore: () => null,
}))
vi.mock('@/app/components/datasets/common/retrieval-method-config', () => ({ default: () => null }))
vi.mock('@/app/components/datasets/common/economical-retrieval-method-config', () => ({
  default: () => null,
}))
vi.mock('@/app/components/datasets/external-knowledge-base/create/RetrievalSettings', () => ({
  default: () => null,
}))

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

const mockDataset: DataSet = {
  id: 'dataset-1',
  name: 'Test Dataset',
  description: 'Test description',
  permission: DatasetPermission.onlyMe,
  icon_info: {
    icon_type: 'emoji',
    icon: '📚',
    icon_background: '#FFFFFF',
    icon_url: '',
  },
  indexing_technique: IndexingType.ECONOMICAL,
  indexing_status: 'completed',
  data_source_type: DataSourceType.FILE,
  doc_form: ChunkingMode.text,
  embedding_model: 'text-embedding-ada-002',
  embedding_model_provider: 'openai',
  embedding_available: true,
  app_count: 0,
  document_count: 5,
  total_document_count: 5,
  word_count: 1000,
  provider: 'vendor',
  tags: [],
  partial_member_list: [],
  external_knowledge_info: {
    external_knowledge_id: 'ext-1',
    external_knowledge_api_id: 'api-1',
    external_knowledge_api_name: 'External API',
    external_knowledge_api_endpoint: 'https://api.example.com',
  },
  external_retrieval_model: {
    top_k: 3,
    score_threshold: 0.7,
    score_threshold_enabled: true,
  },
  retrieval_model_dict: mockRetrievalConfig,
  retrieval_model: mockRetrievalConfig,
  built_in_field_enabled: false,
  keyword_number: 10,
  created_by: 'user-1',
  updated_by: 'user-1',
  updated_at: 0,
  runtime_mode: 'general',
  enable_api: true,
  is_multimodal: false,
}

const UpgradeSettings = () => {
  const [indexMethod, setIndexMethod] = useState<IndexingType | undefined>(IndexingType.ECONOMICAL)
  return (
    <IndexingSection
      currentDataset={mockDataset}
      indexMethod={indexMethod}
      setIndexMethod={setIndexMethod}
      keywordNumber={10}
      setKeywordNumber={vi.fn()}
      embeddingModel={{ provider: 'openai', model: 'text-embedding-ada-002' }}
      setEmbeddingModel={vi.fn()}
      embeddingModelList={[]}
      retrievalConfig={mockRetrievalConfig}
      setRetrievalConfig={vi.fn()}
      summaryIndexSetting={undefined}
      handleSummaryIndexSettingChange={vi.fn()}
      showMultiModalTip={false}
    />
  )
}

const expectTextWithin = (element: Element, container: Element) => {
  const range = document.createRange()
  range.selectNodeContents(element)
  const bounds = container.getBoundingClientRect()
  const lines = [...range.getClientRects()]
  expect(lines.length).toBeGreaterThan(1)
  for (const line of lines) {
    expect(line.left).toBeGreaterThanOrEqual(bounds.left - 1)
    expect(line.right).toBeLessThanOrEqual(bounds.right + 1)
    expect(line.top).toBeGreaterThanOrEqual(bounds.top - 1)
    expect(line.bottom).toBeLessThanOrEqual(bounds.bottom + 1)
  }
  expect(bounds.right).toBeLessThanOrEqual(220)
}

describe('Knowledge settings narrow-screen readability', () => {
  beforeEach(async () => {
    await page.viewport(320, 900)
  })
  afterEach(async () => {
    await page.viewport(1280, 720)
  })

  // DOM presence checks miss text painted outside fixed-height warnings and long URL fields.
  // Keep the production sections and assert every rendered text line fits its visible field.
  it('keeps the full upgrade warning inside its panel after selecting High Quality', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const screen = await render(
      <QueryClientProvider client={queryClient}>
        <div className="@container/settings" style={{ width: 220 }}>
          <UpgradeSettings />
        </div>
      </QueryClientProvider>,
    )
    await screen.getByRole('radio', { name: /High Quality/ }).click()
    const warning = screen.getByText(datasetSettings['form.upgradeHighQualityTip'])
    await expect.element(warning).toBeVisible()
    const text = warning.element()
    expectTextWithin(text, text.parentElement!)
    queryClient.clear()
  })

  it('wraps a long external API endpoint so the entire address can be read', async () => {
    const endpoint =
      'https://knowledge-api.example.com/retrieval/customer-specific-knowledge-collection-with-a-long-identifier'
    const screen = await render(
      <div className="@container/settings" style={{ width: 220 }}>
        <ExternalKnowledgeSection
          currentDataset={{
            ...mockDataset,
            provider: 'external',
            external_knowledge_info: {
              ...mockDataset.external_knowledge_info,
              external_knowledge_api_endpoint: endpoint,
            },
          }}
          topK={3}
          scoreThreshold={0.5}
          scoreThresholdEnabled={false}
          handleSettingsChange={vi.fn()}
        />
      </div>,
    )
    const address = screen.getByText(endpoint)
    await expect.element(address).toBeVisible()
    const text = address.element()
    expectTextWithin(text, text.parentElement!)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320)
  })
})
