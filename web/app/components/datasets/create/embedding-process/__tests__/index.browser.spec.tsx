import type { DocumentStatusResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { ComponentProps, MouseEvent } from 'react'
import type { consoleClient } from '@/service/console'
import { zDocumentResponse } from '@dify/contracts/api/console/datasets/zod.gen'
import { useQuery } from '@tanstack/react-query'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { ProcessMode } from '@/models/datasets'
import { consoleQuery } from '@/service/console'
import { createConfigurationModalTestWrapper } from '@/test/configuration-modals-browser'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { RETRIEVE_METHOD } from '@/types/app'
import EmbeddingProcess from '../index'

// boundary: Browser Mode does not navigate a Next application; preserve native link semantics and click handlers.
vi.mock('@/next/link', () => ({
  default: ({ href, children, onClick, ...props }: ComponentProps<'a'>) => (
    <a
      {...props}
      href={href}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        event.preventDefault()
        onClick?.(event)
      }}
    >
      {children}
    </a>
  ),
}))
const api = vi.hoisted(() => ({
  status: vi.fn<typeof consoleClient.datasets.byDatasetId.batch.byBatch.indexingStatus.get>(),
  rule: vi.fn<typeof consoleClient.datasets.processRule.get>(),
  documents: vi.fn<typeof consoleClient.datasets.byDatasetId.documents.get>(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'datasets.byDatasetId.batch.byBatch.indexingStatus.get': api.status,
    }),
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'datasets.processRule.get': api.rule,
      'datasets.byDatasetId.documents.get': api.documents,
    }),
  }
})
const document = zDocumentResponse.parse({
  id: 'document-1',
  name: 'report.pdf',
  position: 1,
  data_source_type: 'upload_file',
  indexing_status: 'completed',
  enabled: true,
  archived: false,
  display_status: 'available',
  created_at: 1700000000,
  doc_form: 'text_model',
  data_source_detail_dict: {},
})
const status = (overrides: Partial<DocumentStatusResponse> = {}): DocumentStatusResponse => ({
  id: document.id,
  indexing_status: 'completed',
  completed_segments: 1,
  total_segments: 1,
  processing_started_at: null,
  parsing_completed_at: null,
  cleaning_completed_at: null,
  splitting_completed_at: null,
  completed_at: null,
  paused_at: null,
  error: null,
  stopped_at: null,
  ...overrides,
})
const rule = {
  limits: { indexing_max_segmentation_tokens_length: 4000 },
  mode: ProcessMode.general,
  rules: {
    segmentation: { separator: '\n', max_tokens: 500, chunk_overlap: 50 },
    pre_processing_rules: [
      { id: 'remove_extra_spaces', enabled: true },
      { id: 'remove_urls_emails', enabled: false },
    ],
  },
} satisfies Awaited<ReturnType<typeof consoleClient.datasets.processRule.get>>

beforeEach(() => {
  onTestFinished(guardUnexpectedFetch())
  api.status.mockReset().mockResolvedValue({ data: [status()] })
  api.rule.mockReset().mockResolvedValue(rule)
  api.documents
    .mockReset()
    .mockResolvedValue({ data: [], total: 2, has_more: false, page: 1, limit: 20 })
})
afterEach(() => vi.useRealTimers())

async function setup({
  plan = 'sandbox',
  edition = 'COMMUNITY',
  indexingType = 'high_quality',
  showDocumentSummary = false,
}: {
  plan?: 'sandbox' | 'professional' | 'team'
  edition?: 'CLOUD' | 'COMMUNITY'
  indexingType?: string
  showDocumentSummary?: boolean
} = {}) {
  const { queryClient, wrapper: Providers } = createConfigurationModalTestWrapper({
    systemFeatures: { deployment_edition: edition },
    features: { billing: { subscription: { plan } } },
  })
  const documentOptions = consoleQuery.datasets.byDatasetId.documents.get.queryOptions({
    input: { params: { dataset_id: 'dataset-1' } },
  })
  if (showDocumentSummary)
    queryClient.setQueryData(documentOptions.queryKey, {
      data: [],
      total: 1,
      has_more: false,
      page: 1,
      limit: 20,
    })
  function DocumentSummary() {
    const { data } = useQuery(documentOptions)
    return <output aria-label="Documents in knowledge">{data?.total}</output>
  }
  return render(
    <Providers>
      <EmbeddingProcess
        datasetId="dataset-1"
        batchId="batch-1"
        documents={[document]}
        indexingType={indexingType}
        retrievalMethod={RETRIEVE_METHOD.semantic}
      />
      {showDocumentSummary && <DocumentSummary />}
    </Providers>,
  )
}

it('polls real indexing progress and announces completion without retaining a progress bar', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  api.status.mockResolvedValueOnce({
    data: [status({ indexing_status: 'indexing', completed_segments: 50, total_segments: 100 })],
  })
  const screen = await setup()
  const progress = screen.getByRole('progressbar', { name: 'report.pdf' })
  await expect.element(progress).toHaveAttribute('aria-valuenow', '50')
  await expect
    .element(
      screen.getByRole('status').filter({ hasText: 'datasetDocuments.embedding.processing' }),
    )
    .toBeVisible()
  await vi.advanceTimersByTimeAsync(2499)
  await expect.element(progress).toHaveAttribute('aria-valuenow', '50')
  expect(api.status).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1)
  await expect.element(progress).not.toBeInTheDocument()
  await expect
    .element(
      screen
        .getByRole('status')
        .filter({ hasText: 'report.pdf: datasetDocuments.embedding.completed' }),
    )
    .toHaveTextContent('report.pdf: datasetDocuments.embedding.completed')
  await vi.advanceTimersByTimeAsync(5000)
  expect(api.status).toHaveBeenCalledTimes(2)
})

it.each(['Parse failed', null])(
  'reveals the full indexing error and restores keyboard focus (%s)',
  async (error) => {
    api.status.mockResolvedValue({ data: [status({ indexing_status: 'error', error })] })
    const screen = await setup()
    const trigger = screen.getByRole('button', { name: 'common.error', exact: true })
    await trigger.click()
    const dialog = screen.getByRole('dialog', { name: 'common.error', exact: true })
    await expect.element(dialog).toHaveTextContent(error ?? 'common.error')
    await userEvent.keyboard('{Escape}')
    await expect.element(dialog).not.toBeInTheDocument()
    await expect.element(trigger).toHaveFocus()
  },
)

it.each([
  { edition: 'COMMUNITY', plan: 'sandbox' },
  { edition: 'CLOUD', plan: 'team' },
] as const)(
  'shows the vector admission explanation without an upgrade for $edition/$plan',
  async ({ edition, plan }) => {
    api.status.mockResolvedValue({
      data: [
        status({
          indexing_status: 'error',
          error_code: 'vector_space_estimate_exceeded',
          estimated_vector_space_mb: 61,
          vector_space_limit_mb: 50,
        }),
      ],
    })
    const screen = await setup({ edition, plan })
    const alert = screen.getByRole('alert')
    await expect
      .element(alert)
      .toMatchTextContent('datasetDocuments.embedding.vectorSpaceEstimateExceeded.description')
    await expect.element(alert).toMatchTextContent('61')
    await expect.element(alert).toMatchTextContent('50')
    await expect.element(alert.getByRole('button')).not.toBeInTheDocument()
    await expect
      .element(screen.getByText('billing.plansCommon.documentProcessingPriorityUpgrade'))
      .not.toBeInTheDocument()
  },
)

it('keeps other indexing errors out of the vector-space admission alert', async () => {
  api.status.mockResolvedValue({
    data: [
      status({
        indexing_status: 'error',
        error_code: null,
        estimated_vector_space_mb: 61,
        vector_space_limit_mb: 50,
      }),
    ],
  })
  const screen = await setup()
  await expect
    .element(screen.getByRole('button', { name: 'common.error', exact: true }))
    .toBeVisible()
  await expect.element(screen.getByRole('alert')).not.toBeInTheDocument()
})

it('offers the real processing-priority upgrade for a cloud sandbox', async () => {
  const screen = await setup({ edition: 'CLOUD' })
  await expect
    .element(screen.getByText('billing.plansCommon.documentProcessingPriorityUpgrade'))
    .toBeVisible()
  await expect
    .element(screen.getByRole('button', { name: 'billing.upgradeBtn.encourage' }))
    .toBeEnabled()
})

it('links to the real API reference and refreshes subscribed documents on navigation', async () => {
  const screen = await setup({ showDocumentSummary: true })
  await expect
    .element(screen.getByRole('link', { name: 'Access the API' }))
    .toHaveAttribute('href', 'https://docs.dify.ai/en/api-reference/guides/knowledge')
  const summary = screen.getByRole('status', { name: 'Documents in knowledge' })
  await expect.element(summary).toHaveTextContent('1')
  const link = screen.getByRole('link', { name: 'datasetCreation.stepThree.navTo' })
  await expect.element(link).toHaveAttribute('href', '/datasets/dataset-1/documents')
  await link.click()
  await expect.element(summary).toHaveTextContent('2')
})

it('loads the real custom segmentation summary and only enabled cleaning rules', async () => {
  const screen = await setup()
  await expect
    .element(screen.getByText('datasetDocuments.embedding.custom', { exact: true }))
    .toBeVisible()
  await expect.element(screen.getByText('500', { exact: true })).toBeVisible()
  await expect
    .element(screen.getByText('datasetCreation.stepTwo.removeExtraSpaces', { exact: true }))
    .toBeVisible()
  await expect
    .element(screen.getByText('datasetCreation.stepTwo.removeUrlEmails', { exact: true }))
    .not.toBeInTheDocument()
  await expect
    .element(screen.getByText('datasetCreation.stepTwo.qualified', { exact: true }))
    .toBeVisible()
  await expect
    .element(screen.getByText('dataset.retrieval.semantic_search.title', { exact: true }))
    .toBeVisible()
})

it('summarizes parent and child chunk limits from the process rule response', async () => {
  api.rule.mockResolvedValue({
    ...rule,
    mode: ProcessMode.parentChild,
    rules: {
      parent_mode: 'paragraph',
      segmentation: { separator: '\n', max_tokens: 1000, chunk_overlap: 50 },
      subchunk_segmentation: { separator: '\n', max_tokens: 200, chunk_overlap: 20 },
    },
  })
  const screen = await setup()
  await expect
    .element(
      screen.getByText('datasetDocuments.embedding.hierarchical · dataset.parentMode.paragraph', {
        exact: true,
      }),
    )
    .toBeVisible()
  await expect
    .element(
      screen.getByText(
        'datasetDocuments.embedding.parentMaxTokens 1000; datasetDocuments.embedding.childMaxTokens 200',
        { exact: true },
      ),
    )
    .toBeVisible()
})

it('uses keyword retrieval for economical indexing even when semantic retrieval was requested', async () => {
  const screen = await setup({ indexingType: 'economy' })
  await expect
    .element(screen.getByText('datasetCreation.stepTwo.economical', { exact: true }))
    .toBeVisible()
  await expect
    .element(screen.getByText('dataset.retrieval.keyword_search.title', { exact: true }))
    .toBeVisible()
  await expect
    .element(screen.getByText('dataset.retrieval.semantic_search.title', { exact: true }))
    .not.toBeInTheDocument()
})
