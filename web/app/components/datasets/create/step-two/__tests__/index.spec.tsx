import type {
  DatasetDetailWithPartialMembersResponse,
  DatasetRetrievalModelResponse,
  DocumentDetailResponse,
} from '@dify/contracts/api/console/datasets/types.gen'
import type { StepTwoProps } from '../types'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { assert } from 'vite-plus/test'
import { toast } from '@/app/notifications'
import { AppToaster } from '@/app/notifications/app-toaster'
import DatasetDetailContext from '@/context/dataset-detail'
import { DataSourceProvider } from '@/models/common'
import { ChunkingMode, DataSourceType } from '@/models/datasets'
import { consoleQuery } from '@/service/console'
import {
  createCatalogModelFixture,
  createDefaultModelFixture,
  createModelCatalogFixture,
  seedModelProviderQueries,
} from '@/test/console/model-provider'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { createNuqsTestRenderer } from '@/test/nuqs-testing'
import StepTwo from '../index'

const api = vi.hoisted(() => ({
  create: vi.fn<typeof import('@/service/console').consoleClient.datasets.init.post>(),
  save: vi.fn<
    typeof import('@/service/console').consoleClient.datasets.byDatasetId.documents.post
  >(),
  estimate:
    vi.fn<typeof import('@/service/console').consoleClient.datasets.indexingEstimate.post>(),
  rules: vi.fn<typeof import('@/service/console').consoleClient.datasets.processRule.get>(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'datasets.processRule.get': api.rules,
      'datasets.indexingEstimate.post': api.estimate,
      'datasets.init.post': api.create,
      'datasets.byDatasetId.documents.post': api.save,
    }),
  }
})

const document: DocumentDetailResponse = {
  id: 'doc-1',
  name: 'Handbook',
  doc_form: ChunkingMode.text,
  doc_language: 'English',
  dataset_process_rule: {
    mode: 'custom',
    rules: {
      segmentation: { separator: '\\n\\n', max_tokens: 1024, chunk_overlap: 50 },
      pre_processing_rules: [{ id: 'remove_extra_spaces', enabled: true }],
    },
  },
}
const saved = { batch: 'batch-1', dataset: { id: 'dataset-1', name: 'Handbook' }, documents: [] }
const render = createNuqsTestRenderer(renderWithConsoleQuery)

async function setup(
  props: Partial<StepTwoProps> = {},
  dataset?: DatasetDetailWithPartialMembersResponse,
  defaultModels: { embedding?: boolean; rerank?: boolean } = {},
) {
  const queryClient = createConsoleQueryClient()
  seedModelProviderQueries(queryClient, [
    createModelCatalogFixture({
      models: [
        createCatalogModelFixture({
          model: 'text-embedding-ada-002',
          model_type: 'text-embedding',
          label: { en_US: 'Ada Embedding' },
        }),
        createCatalogModelFixture({ model: 'gpt-4', model_type: 'llm', label: { en_US: 'GPT-4' } }),
      ],
    }),
    createModelCatalogFixture({
      provider: 'cohere',
      models: [createCatalogModelFixture({ model: 'rerank-english-v3.0', model_type: 'rerank' })],
    }),
  ])
  for (const model_type of ['text-embedding', 'rerank'] as const) {
    queryClient.setQueryData(
      consoleQuery.workspaces.current.defaultModel.get.queryKey({
        input: { query: { model_type } },
      }),
      {
        data:
          defaultModels[model_type === 'text-embedding' ? 'embedding' : 'rerank'] === false
            ? null
            : createDefaultModelFixture({
                model_type,
                model:
                  model_type === 'text-embedding'
                    ? 'text-embedding-ada-002'
                    : 'rerank-english-v3.0',
                provider: { provider: model_type === 'text-embedding' ? 'openai' : 'cohere' },
              }),
      },
    )
  }
  queryClient.setQueryData(consoleQuery.datasets.retrievalSetting.get.queryKey(), {
    retrieval_method: ['semantic_search', 'full_text_search', 'hybrid_search'],
  })
  const onSave = vi.fn()
  const onCancel = vi.fn()
  const tree = (
    // oxlint-disable-next-line eslint-react/no-context-provider -- use-context-selector contexts require their Provider rather than React 19 context rendering.
    <DatasetDetailContext.Provider value={{ dataset }}>
      <AppToaster timeout={0} />
      <StepTwo
        dataSourceType={DataSourceType.FILE}
        files={[{ id: 'file-1', name: 'handbook.pdf', extension: 'pdf' }]}
        isAPIKeySet
        onSetting={vi.fn()}
        notionCredentialId=""
        onSave={onSave}
        onCancel={onCancel}
        datasetId={dataset?.id}
        {...props}
      />
    </DatasetDetailContext.Provider>
  )
  const view = await act(async () =>
    render(tree, { queryClient, systemFeatures: { deployment_edition: 'COMMUNITY' } }),
  )
  return {
    ...view,
    user: userEvent.setup(),
    onSave,
    onCancel,
  }
}

const defaultRules: Awaited<ReturnType<typeof api.rules>> = {
  mode: 'custom',
  rules: {
    segmentation: { separator: '\\n', max_tokens: 500, chunk_overlap: 50 },
    pre_processing_rules: [
      { id: 'remove_extra_spaces', enabled: true },
      { id: 'remove_urls_emails', enabled: false },
    ],
    parent_mode: 'paragraph',
    subchunk_segmentation: { separator: '\\n', max_tokens: 256, chunk_overlap: 0 },
  },
  limits: { indexing_max_segmentation_tokens_length: 4000 },
}

beforeEach(() => {
  toast.dismiss()
  api.create.mockReset().mockResolvedValue(saved)
  api.save.mockReset().mockResolvedValue(saved)
  api.estimate.mockReset().mockResolvedValue({
    total_segments: 1,
    tokens: 100,
    total_price: 0.01,
    currency: 'USD',
    qa_preview: [{ question: 'Question', answer: 'Answer' }],
    preview: [{ content: 'Previewed chunk', child_chunks: ['Child chunk'] }],
  })
  api.rules.mockReset().mockResolvedValue(defaultRules)
})
afterEach(() => {
  act(() => toast.dismiss())
  vi.unstubAllGlobals()
})

it('keeps the chunk mode and preview while editing its delimiter with an arrow key', async () => {
  const { user } = await setup()
  await user.click(screen.getByRole('button', { name: 'datasetCreation.stepTwo.previewChunk' }))
  expect(await screen.findByText('Previewed chunk')).toBeInTheDocument()
  const input = screen.getByRole('textbox', { name: 'datasetCreation.stepTwo.separator' })
  await user.click(input)
  await user.keyboard('{End}{ArrowDown}')
  expect(input).toHaveFocus()
  expect(screen.getByRole('radio', { name: 'datasetCreation.stepTwo.general' })).toBeChecked()
  expect(
    screen.getByRole('radio', { name: 'datasetCreation.stepTwo.parentChild' }),
  ).not.toBeChecked()
  expect(screen.getByText('Previewed chunk')).toBeInTheDocument()
})

it('opens the mobile preview with fetched chunks and restores its trigger after closing', async () => {
  vi.stubGlobal('innerWidth', 480)
  const { user } = await setup()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  const trigger = screen.getByRole('button', { name: 'datasetCreation.stepTwo.previewChunk' })
  await user.click(trigger)
  const drawer = await screen.findByRole('dialog', { name: 'datasetCreation.stepTwo.preview' })
  expect(await within(drawer).findByText('Previewed chunk')).toBeInTheDocument()
  await user.click(within(drawer).getByRole('button', { name: 'common.operation.close' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(trigger).toHaveFocus()
})

it('initializes document settings from saved rules and saves edits before notifying the owner', async () => {
  const pending = createDeferred<Awaited<ReturnType<typeof api.save>>>()
  api.save.mockReturnValue(pending.promise)
  const { user, onSave } = await setup(
    { isSetting: true, documentDetail: document },
    createDatasetFixture(),
  )
  const length = screen.getByRole('textbox', { name: 'datasetCreation.stepTwo.maxLength' })
  expect(length).toHaveValue('1,024')
  await user.clear(length)
  await user.type(length, '800')
  const save = screen.getByRole('button', { name: 'datasetCreation.stepTwo.save' })
  await user.click(save)
  expect(onSave).not.toHaveBeenCalled()
  expect(save).toHaveAttribute('aria-disabled', 'true')
  await user.click(save)
  expect(api.save).toHaveBeenCalledExactlyOnceWith({
    params: { dataset_id: 'dataset-1' },
    body: expect.objectContaining({
      original_document_id: 'doc-1',
      doc_form: ChunkingMode.text,
      process_rule: expect.objectContaining({
        rules: expect.objectContaining({
          segmentation: { separator: '\n\n', max_tokens: 800, chunk_overlap: 50 },
        }),
      }),
    }),
  })
  await act(async () => pending.resolve(saved))
  await waitFor(() => expect(onSave).toHaveBeenCalledOnce())
})

it('retains failed document edits for retry', async () => {
  api.save.mockRejectedValueOnce(new Error('Save failed'))
  const { user, onSave } = await setup(
    { isSetting: true, documentDetail: document },
    createDatasetFixture(),
  )
  const length = screen.getByRole('textbox', { name: 'datasetCreation.stepTwo.maxLength' })
  await user.clear(length)
  await user.type(length, '700')
  const save = screen.getByRole('button', { name: 'datasetCreation.stepTwo.save' })
  await user.click(save)
  await waitFor(() => expect(save).not.toHaveAttribute('aria-disabled', 'true'))
  expect(length).toHaveValue('700')
  expect(onSave).not.toHaveBeenCalled()
  await user.click(save)
  await waitFor(() => expect(onSave).toHaveBeenCalledOnce())
  expect(api.save.mock.calls[1]).toEqual(api.save.mock.calls[0])
  expect(api.save).toHaveBeenCalledTimes(2)
})

it.each([
  {
    form: ChunkingMode.parentChild,
    visible: 'datasetCreation.stepTwo.parentChild',
    hidden: 'datasetCreation.stepTwo.general',
  },
  {
    form: ChunkingMode.text,
    visible: 'datasetCreation.stepTwo.general',
    hidden: 'datasetCreation.stepTwo.parentChild',
  },
])(
  'uses the existing dataset chunk format $form and locks its model and retrieval settings',
  async ({ form, visible, hidden }) => {
    await setup({}, createDatasetFixture({ doc_form: form }))
    expect(screen.getByText(visible)).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: hidden })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Ada Embedding/ })).toBeDisabled()
    expect(
      screen.getByRole('radio', { name: 'dataset.retrieval.semantic_search.title' }),
    ).toBeDisabled()
  },
)

it('lets an empty dataset choose chunking format before its first document', async () => {
  const { user } = await setup({}, createDatasetFixture({ doc_form: null, data_source_type: null }))
  const general = screen.getByRole('radio', { name: 'datasetCreation.stepTwo.general' })
  const parentChild = screen.getByRole('radio', { name: 'datasetCreation.stepTwo.parentChild' })
  expect(general).toBeChecked()
  await user.click(parentChild)
  expect(parentChild).toBeChecked()
  expect(general).not.toBeChecked()
  expect(screen.getByRole('button', { name: /Ada Embedding/ })).toBeEnabled()
})

it('switches economical indexing to high quality when parent-child chunking is selected', async () => {
  const { user } = await setup()
  await user.click(screen.getByRole('radio', { name: 'datasetCreation.stepTwo.economical' }))
  await user.click(screen.getByRole('radio', { name: 'datasetCreation.stepTwo.parentChild' }))
  expect(screen.getByRole('radio', { name: /stepTwo.qualified/ })).toBeChecked()
  expect(screen.getByRole('radio', { name: 'datasetCreation.stepTwo.parentChild' })).toBeChecked()
})

it('keeps economical indexing when Q&A conversion is canceled and switches only after confirmation', async () => {
  const { user } = await setup()
  const economy = screen.getByRole('radio', { name: 'datasetCreation.stepTwo.economical' })
  await user.click(economy)
  const qa = screen.getByRole('checkbox', { name: /stepTwo.useQALanguage/ })
  await user.click(qa)
  let dialog = await screen.findByRole('alertdialog')
  await user.click(within(dialog).getByRole('button', { name: 'datasetCreation.stepTwo.cancel' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  expect(economy).toBeChecked()
  expect(qa).not.toBeChecked()
  await user.click(qa)
  dialog = await screen.findByRole('alertdialog')
  await user.click(within(dialog).getByRole('button', { name: 'datasetCreation.stepTwo.switch' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  expect(screen.getByRole('radio', { name: /stepTwo.qualified/ })).toBeChecked()
  expect(qa).toBeChecked()
})

it('cancels document rule edits without submitting them', async () => {
  const { user, onCancel } = await setup(
    { isSetting: true, documentDetail: document },
    createDatasetFixture(),
  )
  const length = screen.getByRole('textbox', { name: 'datasetCreation.stepTwo.maxLength' })
  await user.clear(length)
  await user.type(length, '700')
  await user.click(screen.getByRole('button', { name: 'datasetCreation.stepTwo.cancel' }))
  expect(onCancel).toHaveBeenCalledOnce()
  expect(api.save).not.toHaveBeenCalled()
})

it.each([
  {
    source: 'files with the same name',
    props: {
      files: [
        { id: 'file-1', name: 'handbook.pdf', extension: 'pdf' },
        { id: 'file-2', name: 'handbook.pdf', extension: 'pdf' },
      ],
    },
    firstName: 'handbook.pdf',
    nextName: 'handbook.pdf',
    optionIndex: 1,
    info: { data_source_type: DataSourceType.FILE, file_info_list: { file_ids: ['file-2'] } },
  },
  {
    source: 'Notion pages',
    props: {
      dataSourceType: DataSourceType.NOTION,
      files: [],
      notionCredentialId: 'credential-1',
      notionPages: [
        {
          page_id: 'page-1',
          page_name: 'Guide',
          page_icon: null,
          type: 'page',
          workspace_id: 'workspace-1',
        },
        {
          page_id: 'page-2',
          page_name: 'Reference',
          page_icon: null,
          type: 'page',
          workspace_id: 'workspace-1',
        },
      ],
    },
    firstName: 'Guide',
    nextName: 'Reference',
    optionIndex: 0,
    info: {
      data_source_type: DataSourceType.NOTION,
      notion_info_list: [
        {
          credential_id: 'credential-1',
          workspace_id: 'workspace-1',
          pages: [expect.objectContaining({ page_id: 'page-2' })],
        },
      ],
    },
  },
  {
    source: 'crawled pages',
    props: {
      dataSourceType: DataSourceType.WEB,
      files: [],
      websiteCrawlProvider: DataSourceProvider.jinaReader,
      websiteCrawlJobId: 'job-1',
      websitePages: [
        {
          source_url: 'https://example.com/guide',
          title: 'Guide',
          markdown: 'Guide content',
          description: '',
        },
        {
          source_url: 'https://example.com/reference',
          title: 'Reference',
          markdown: 'Reference content',
          description: '',
        },
      ],
    },
    firstName: 'Guide',
    nextName: 'Reference',
    optionIndex: 0,
    info: {
      data_source_type: DataSourceType.WEB,
      website_info_list: expect.objectContaining({
        provider: DataSourceProvider.jinaReader,
        job_id: 'job-1',
        urls: ['https://example.com/reference'],
      }),
    },
  },
])(
  'previews the newly selected document among $source',
  async ({ props, firstName, nextName, optionIndex, info }) => {
    const { user } = await setup(props)
    expect(screen.getByText('datasetCreation.stepTwo.previewChunkTip')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'datasetCreation.stepTwo.previewChunk' }))
    expect(await screen.findByText('Previewed chunk')).toBeInTheDocument()

    const pending = createDeferred<Awaited<ReturnType<typeof api.estimate>>>()
    api.estimate.mockReturnValueOnce(pending.promise)
    await user.click(screen.getByRole('button', { name: firstName }))
    const picker = await screen.findByRole('dialog')
    const option = within(picker).getAllByRole('button', { name: nextName })[optionIndex]
    assert(option)
    await user.click(option)
    await waitFor(() =>
      expect(api.estimate).toHaveBeenLastCalledWith({
        body: expect.objectContaining({ info_list: info }),
      }),
    )
    expect(screen.getByRole('button', { name: nextName })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('common.loading')
    expect(screen.queryByText('Previewed chunk')).not.toBeInTheDocument()
    await act(async () =>
      pending.resolve({
        total_segments: 1,
        tokens: 200,
        total_price: 0.02,
        currency: 'USD',
        preview: [{ content: 'Selected document chunk' }],
      }),
    )
    expect(await screen.findByText('Selected document chunk')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'datasetCreation.stepTwo.previewChunk' }))
    expect(api.estimate).toHaveBeenLastCalledWith({
      body: expect.objectContaining({ info_list: info }),
    })
  },
)

it.each([
  {
    name: 'overlap beyond the chunk length',
    field: 'overlap',
    value: '600',
    message: 'overlapCheck',
    corrected: '40',
  },
  {
    name: 'chunk length beyond the server limit',
    field: 'maxLength',
    value: '900',
    message: 'maxLengthCheck:{"limit":800}',
    corrected: '700',
  },
])('rejects $name and submits after correction', async ({ field, value, message, corrected }) => {
  api.rules.mockResolvedValue({
    ...defaultRules,
    limits: { indexing_max_segmentation_tokens_length: 800 },
  })
  const { user } = await setup()
  const input = screen.getByRole('textbox', { name: `datasetCreation.stepTwo.${field}` })
  await user.clear(input)
  await user.type(input, value)
  const next = screen.getByRole('button', { name: 'datasetCreation.stepTwo.nextStep' })
  await user.click(next)
  expect(await screen.findByText(`datasetCreation.stepTwo.${message}`)).toBeInTheDocument()
  expect(api.create).not.toHaveBeenCalled()
  await user.clear(input)
  await user.type(input, corrected)
  await user.click(next)
  await waitFor(() => expect(api.create).toHaveBeenCalledOnce())
})

it('requires an embedding model for high-quality indexing but permits economical indexing', async () => {
  const { user } = await setup({ isAPIKeySet: false }, undefined, { embedding: false })
  await user.click(screen.getByRole('radio', { name: /stepTwo.qualified/ }))
  const next = screen.getByRole('button', { name: 'datasetCreation.stepTwo.nextStep' })
  await user.click(next)
  expect(
    await screen.findByText('appDebug.datasetConfig.embeddingModelRequired'),
  ).toBeInTheDocument()
  expect(api.create).not.toHaveBeenCalled()
  await user.click(screen.getByRole('radio', { name: 'datasetCreation.stepTwo.economical' }))
  await user.click(next)
  await waitFor(() => expect(api.create).toHaveBeenCalledOnce())
  expect(api.create).toHaveBeenCalledWith({
    body: expect.objectContaining({ indexing_technique: 'economy' }),
  })
})

it('requires a rerank model when hybrid search uses model reranking', async () => {
  const { user } = await setup({}, undefined, { rerank: false })
  await user.click(screen.getByRole('radio', { name: 'dataset.retrieval.hybrid_search.title' }))
  await user.click(
    screen.getByRole('radio', { name: /^modelProvider.modelProvider.rerankModel.key/ }),
  )
  await user.click(screen.getByRole('button', { name: 'datasetCreation.stepTwo.nextStep' }))
  expect(await screen.findByText('appDebug.datasetConfig.rerankModelRequired')).toBeInTheDocument()
  expect(api.create).not.toHaveBeenCalled()
})

it('serializes edited delimiters and cleaning rules, then restores server defaults on reset', async () => {
  const { user } = await setup()
  const delimiter = screen.getByRole('textbox', { name: 'datasetCreation.stepTwo.separator' })
  await user.clear(delimiter)
  await user.type(delimiter, String.raw`\n---\n`)
  const removeSpaces = screen.getByRole('checkbox', {
    name: 'datasetCreation.stepTwo.removeExtraSpaces',
  })
  const removeUrls = screen.getByRole('checkbox', {
    name: 'datasetCreation.stepTwo.removeUrlEmails',
  })
  await user.click(removeSpaces)
  await user.click(removeUrls)
  const preview = screen.getByRole('button', { name: 'datasetCreation.stepTwo.previewChunk' })
  await user.click(preview)
  expect(api.estimate).toHaveBeenLastCalledWith({
    body: expect.objectContaining({
      process_rule: expect.objectContaining({
        rules: {
          segmentation: { separator: '\n---\n', max_tokens: 500, chunk_overlap: 50 },
          pre_processing_rules: [
            { id: 'remove_extra_spaces', enabled: false },
            { id: 'remove_urls_emails', enabled: true },
          ],
        },
      }),
    }),
  })
  await user.click(screen.getByRole('button', { name: 'datasetCreation.stepTwo.reset' }))
  expect(delimiter).toHaveValue(String.raw`\n`)
  expect(removeSpaces).toBeChecked()
  expect(removeUrls).not.toBeChecked()
  await user.click(preview)
  expect(api.estimate).toHaveBeenLastCalledWith({
    body: expect.objectContaining({
      process_rule: expect.objectContaining({
        rules: expect.objectContaining({
          segmentation: { separator: '\n', max_tokens: 500, chunk_overlap: 50 },
        }),
      }),
    }),
  })
  await user.click(screen.getByRole('radio', { name: 'datasetCreation.stepTwo.parentChild' }))
  expect(screen.queryByText('Previewed chunk')).not.toBeInTheDocument()
  expect(screen.getByText('datasetCreation.stepTwo.previewChunkTip')).toBeInTheDocument()
})

it('keeps the existing dataset retrieval configuration when saving document chunking rules', async () => {
  const retrieval: DatasetRetrievalModelResponse = {
    search_method: 'full_text_search',
    reranking_enable: false,
    reranking_model: { reranking_provider_name: '', reranking_model_name: '' },
    top_k: 5,
    score_threshold_enabled: true,
    score_threshold: 0.8,
  }
  const { user } = await setup(
    { isSetting: true, documentDetail: document, indexingType: 'economy' },
    createDatasetFixture({ indexing_technique: 'economy', retrieval_model_dict: retrieval }),
  )
  expect(screen.queryByRole('radio', { name: /stepTwo.qualified/ })).not.toBeInTheDocument()
  const length = screen.getByRole('textbox', { name: 'datasetCreation.stepTwo.maxLength' })
  await user.clear(length)
  await user.type(length, '700')
  await user.click(screen.getByRole('button', { name: 'datasetCreation.stepTwo.save' }))
  await waitFor(() => expect(api.save).toHaveBeenCalledOnce())
  expect(api.save).toHaveBeenCalledWith({
    params: { dataset_id: 'dataset-1' },
    body: expect.objectContaining({ indexing_technique: 'economy', retrieval_model: retrieval }),
  })
})

it('serializes parent and child chunk edits and restores both configurations on reset', async () => {
  const { user } = await setup()
  await user.click(screen.getByRole('radio', { name: 'datasetCreation.stepTwo.parentChild' }))
  const [parentDelimiter, childDelimiter] = screen.getAllByRole('textbox', {
    name: 'datasetCreation.stepTwo.separator',
  })
  assert(parentDelimiter && childDelimiter)
  await user.clear(parentDelimiter)
  await user.type(parentDelimiter, String.raw`\n---\n`)
  await user.clear(childDelimiter)
  await user.type(childDelimiter, ';')
  const [parentLength, childLength] = screen.getAllByRole('textbox', {
    name: 'datasetCreation.stepTwo.maxLength',
  })
  assert(parentLength && childLength)
  await user.clear(parentLength)
  await user.type(parentLength, '900')
  await user.clear(childLength)
  await user.type(childLength, '200')
  await user.click(
    screen.getByRole('checkbox', { name: 'datasetCreation.stepTwo.removeUrlEmails' }),
  )
  const preview = screen.getByRole('button', { name: 'datasetCreation.stepTwo.previewChunk' })
  await user.click(preview)
  expect(api.estimate).toHaveBeenLastCalledWith({
    body: expect.objectContaining({
      doc_form: ChunkingMode.parentChild,
      process_rule: expect.objectContaining({
        mode: 'hierarchical',
        rules: {
          parent_mode: 'paragraph',
          segmentation: { separator: '\n---\n', max_tokens: 900 },
          subchunk_segmentation: { separator: ';', max_tokens: 200 },
          pre_processing_rules: [
            { id: 'remove_extra_spaces', enabled: true },
            { id: 'remove_urls_emails', enabled: true },
          ],
        },
      }),
    }),
  })
  await user.click(screen.getByRole('radio', { name: /^datasetCreation.stepTwo.fullDoc/ }))
  await user.click(preview)
  expect(api.estimate).toHaveBeenLastCalledWith({
    body: expect.objectContaining({
      process_rule: expect.objectContaining({
        rules: expect.objectContaining({ parent_mode: 'full-doc' }),
      }),
    }),
  })
  await user.click(screen.getByRole('button', { name: 'datasetCreation.stepTwo.reset' }))
  expect(screen.getByRole('radio', { name: /^datasetCreation.stepTwo.paragraph/ })).toBeChecked()
  const resetLengths = screen.getAllByRole('textbox', { name: 'datasetCreation.stepTwo.maxLength' })
  expect(resetLengths[0]).toHaveValue('1,024')
  expect(resetLengths[1]).toHaveValue('512')
  await user.click(preview)
  expect(api.estimate).toHaveBeenLastCalledWith({
    body: expect.objectContaining({
      process_rule: expect.objectContaining({
        rules: expect.objectContaining({
          parent_mode: 'paragraph',
          segmentation: { separator: '\n\n', max_tokens: 1024 },
          subchunk_segmentation: { separator: '\n', max_tokens: 512 },
        }),
      }),
    }),
  })
})

it('includes the chosen summary model and instructions in preview and creation requests', async () => {
  const { user } = await setup()
  await user.click(screen.getByRole('switch', { name: 'datasetSettings.form.summaryAutoGen' }))
  await user.click(
    screen.getByRole('button', {
      name: 'datasetSettings.form.summaryModel plugin.detailPanel.configureModel',
    }),
  )
  const picker = await screen.findByRole('dialog', { name: 'plugin.detailPanel.configureModel' })
  await user.click(within(picker).getByText('GPT-4'))
  await user.type(
    screen.getByRole('textbox', { name: 'datasetSettings.form.summaryInstructions' }),
    'Summarize key decisions',
  )
  const summary = {
    enable: true,
    model_provider_name: 'openai',
    model_name: 'gpt-4',
    summary_prompt: 'Summarize key decisions',
  }
  await user.click(screen.getByRole('button', { name: 'datasetCreation.stepTwo.previewChunk' }))
  expect(api.estimate).toHaveBeenCalledWith({
    body: expect.objectContaining({
      process_rule: expect.objectContaining({ summary_index_setting: summary }),
    }),
  })
  await user.click(screen.getByRole('button', { name: 'datasetCreation.stepTwo.nextStep' }))
  await waitFor(() => expect(api.create).toHaveBeenCalledOnce())
  expect(api.create).toHaveBeenCalledWith({
    body: expect.objectContaining({ summary_index_setting: summary }),
  })
})

it('restores stored parent-child rules and saves edited child chunking', async () => {
  const { user } = await setup(
    {
      isSetting: true,
      documentDetail: {
        ...document,
        doc_form: ChunkingMode.parentChild,
        dataset_process_rule: {
          mode: 'hierarchical',
          rules: {
            parent_mode: 'paragraph',
            segmentation: { separator: String.raw`\n---\n`, max_tokens: 900 },
            subchunk_segmentation: { separator: ';', max_tokens: 200 },
            pre_processing_rules: [],
          },
        },
      },
    },
    createDatasetFixture({ doc_form: ChunkingMode.parentChild }),
  )
  const delimiters = screen.getAllByRole('textbox', { name: 'datasetCreation.stepTwo.separator' })
  expect(delimiters[0]).toHaveValue(String.raw`\n---\n`)
  expect(delimiters[1]).toHaveValue(';')
  const [parentLength, childLength] = screen.getAllByRole('textbox', {
    name: 'datasetCreation.stepTwo.maxLength',
  })
  assert(childLength)
  expect(parentLength).toHaveValue('900')
  expect(childLength).toHaveValue('200')
  await user.clear(childLength)
  await user.type(childLength, '180')
  await user.click(screen.getByRole('button', { name: 'datasetCreation.stepTwo.save' }))
  await waitFor(() => expect(api.save).toHaveBeenCalledOnce())
  expect(api.save).toHaveBeenCalledWith({
    params: { dataset_id: 'dataset-1' },
    body: expect.objectContaining({
      original_document_id: 'doc-1',
      doc_form: ChunkingMode.parentChild,
      process_rule: expect.objectContaining({
        mode: 'hierarchical',
        rules: expect.objectContaining({
          segmentation: { separator: '\n---\n', max_tokens: 900 },
          subchunk_segmentation: { separator: ';', max_tokens: 180 },
        }),
      }),
    }),
  })
})
