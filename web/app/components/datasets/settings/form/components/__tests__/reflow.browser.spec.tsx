import type { DatasetDetailWithPartialMembersResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { ReactElement } from 'react'
import type { RetrievalConfig } from '@/types/app'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { useState } from 'react'
import { page } from 'vite-plus/test/browser'
import { render as renderBrowser } from 'vitest-browser-react'
import datasetSettings from '@/i18n/locales/en-US/dataset-settings.json'
import { ChunkingMode, DataSourceType } from '@/models/datasets'
import { PermissionLevel } from '@/models/permission'
import { consoleQuery } from '@/service/console'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { RETRIEVE_METHOD } from '@/types/app'
import { IndexingType } from '../../../../create/step-two'
import ExternalKnowledgeSection from '../external-knowledge-section'
import IndexingSection from '../indexing-section'

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  const { default: settings } = await import('@/i18n/locales/en-US/dataset-settings.json')
  const { default: creation } = await import('@/i18n/locales/en-US/dataset-creation.json')
  const { default: appDebug } = await import('@/i18n/locales/en-US/app-debug.json')
  return createReactI18nextMock({ ...settings, ...creation, ...appDebug })
})

const render = async (ui: ReactElement) => {
  const { queryClient, wrapper: Wrapper } = createConsoleQueryWrapper({
    systemFeatures: { deployment_edition: 'CLOUD' },
  })
  seedModelProviderQueries(queryClient)
  queryClient.setQueryData(consoleQuery.datasets.retrievalSetting.get.queryKey(), {
    retrieval_method: ['semantic_search', 'full_text_search', 'hybrid_search'],
  })
  return renderBrowser(
    <Wrapper>
      <NuqsTestingAdapter>{ui}</NuqsTestingAdapter>
    </Wrapper>,
  )
}

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

const mockDataset: DatasetDetailWithPartialMembersResponse = {
  ...createDatasetFixture(),
  id: 'dataset-1',
  name: 'Test Dataset',
  description: 'Test description',
  permission: PermissionLevel.onlyMe,
  icon_info: {
    icon_type: 'emoji',
    icon: '📚',
    icon_background: '#FFFFFF',
    icon_url: '',
  },
  indexing_technique: IndexingType.ECONOMICAL,
  data_source_type: DataSourceType.FILE,
  doc_form: ChunkingMode.text,
  embedding_model: 'text-embedding-ada-002',
  embedding_model_provider: 'openai',
  embedding_available: true,
  app_count: 0,
  document_count: 5,
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
      graphIndexSetting={undefined}
      handleGraphIndexSettingChange={vi.fn()}
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
}

describe('Knowledge settings narrow-screen readability', () => {
  beforeEach(async () => {
    await page.viewport(320, 900)
  })

  // DOM presence checks miss text painted outside fixed-height warnings and long URL fields.
  // Keep the production sections and assert every rendered text line fits its visible field.
  it('keeps the full upgrade warning inside its panel after selecting High Quality', async () => {
    const screen = await render(
      <div className="@container/settings" style={{ width: 220 }}>
        <UpgradeSettings />
      </div>,
    )
    await screen.getByRole('radio', { name: /High Quality/ }).click()
    const warning = screen.getByText(datasetSettings['form.upgradeHighQualityTip'])
    await expect.element(warning).toBeVisible()
    const text = warning.element()
    expectTextWithin(text, text.parentElement!)
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
