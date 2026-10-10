import type { DataSet, SimpleDocumentDetail } from '@/models/datasets'
import type { PipelineTemplate } from '@/models/pipeline'
import { QueryClient } from '@tanstack/react-query'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { page, userEvent } from 'vite-plus/test/browser'
import { cleanup, render } from 'vitest-browser-react'
import DatasetDropdown from '@/app/components/app-sidebar/dataset-info/dropdown'
import { emojiCatalogOptions } from '@/app/components/base/icon-picker/emoji-data'
import DatasetDetailContext from '@/context/dataset-detail'
import { ChunkingMode, DataSourceType } from '@/models/datasets'
import { consoleQuery } from '@/service/console'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { seedSystemFeatures } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { seedWorkspacePermissionsQuery } from '@/test/console/workspace-permissions'
import { RETRIEVE_METHOD } from '@/types/app'
import { DatasetACLPermission } from '@/utils/permission'
import TemplateCard from '../create-from-pipeline/list/template-card'
import DocumentList from '../documents/components/list'
import Operations from '../documents/components/operations'
import DatasetCard from '../list/dataset-card'

const { get, post, patch, transport } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  transport: vi.fn(),
}))
vi.mock('@/service/console/browser', () => ({ consoleBrowserLink: { call: transport } }))
vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useParams: () => ({ datasetId: 'dataset-1' }),
  usePathname: () => '/datasets/dataset-1/documents',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/service/base', () => ({
  get,
  post,
  request: vi.fn(),
  getPublic: vi.fn(),
  getMarketplace: vi.fn(),
  postPublic: vi.fn(),
  postMarketplace: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  delPublic: vi.fn(),
  patch,
  patchPublic: vi.fn(),
  upload: vi.fn(),
  ssePost: vi.fn(),
  sseGet: vi.fn(),
  sseGeneratorPost: vi.fn(),
  handleStream: vi.fn(),
  buildSigninUrlWithRedirect: vi.fn(),
  isWebAppSigninPath: vi.fn(),
  buildWebAppSigninUrlWithRedirect: vi.fn(),
}))

const retrieval = {
  search_method: RETRIEVE_METHOD.semantic,
  reranking_enable: false,
  reranking_model: { reranking_provider_name: '', reranking_model_name: '' },
  top_k: 4,
  score_threshold_enabled: false,
  score_threshold: 0,
}
const dataset: DataSet = {
  id: 'dataset-1',
  name: 'Knowledge source',
  indexing_status: 'completed',
  icon_info: { icon_type: 'emoji', icon: '📙', icon_background: '#FFF4ED', icon_url: '' },
  description: '',
  permission: 'all_team_members',
  data_source_type: 'upload_file',
  indexing_technique: 'economy',
  created_by: 'user-1',
  maintainer: 'user-1',
  permission_keys: [DatasetACLPermission.Edit],
  updated_by: 'user-1',
  updated_at: 1,
  app_count: 0,
  doc_form: 'text_model',
  document_count: 1,
  total_document_count: 1,
  word_count: 100,
  provider: 'internal',
  embedding_model: 'embedding',
  embedding_model_provider: 'provider',
  embedding_available: true,
  retrieval_model_dict: retrieval,
  retrieval_model: retrieval,
  tags: [],
  external_knowledge_info: {
    external_knowledge_id: '',
    external_knowledge_api_id: '',
    external_knowledge_api_name: '',
    external_knowledge_api_endpoint: '',
  },
  external_retrieval_model: { top_k: 4, score_threshold: 0, score_threshold_enabled: false },
  built_in_field_enabled: false,
  runtime_mode: 'general',
  enable_api: true,
  is_multimodal: false,
}

const pipeline: PipelineTemplate = {
  id: 'template-1',
  name: 'Document pipeline',
  description: 'Process documents',
  icon: { icon_type: 'emoji', icon: '📊', icon_background: '#FFF4ED', icon_url: '' },
  chunk_structure: ChunkingMode.text,
  position: 1,
}
const documentInfo: SimpleDocumentDetail = {
  id: 'doc-1',
  batch: 'batch-1',
  position: 1,
  dataset_id: dataset.id,
  data_source_type: DataSourceType.FILE,
  data_source_info: { upload_file_id: 'file-1' },
  dataset_process_rule_id: 'rule-1',
  name: 'Guide.txt',
  created_from: 'web',
  created_by: 'user-1',
  created_at: 1,
  indexing_status: 'completed',
  display_status: 'available',
  doc_form: ChunkingMode.text,
  doc_language: 'English',
  enabled: true,
  word_count: 100,
  archived: false,
  updated_at: 1,
  hit_count: 0,
}
const clients: QueryClient[] = []
const DatasetProvider = DatasetDetailContext.Provider
const onUpdate = vi.fn()
type Entry = 'dataset-card' | 'dataset-sidebar' | 'template' | 'document-list' | 'document-detail'

async function renderOwner(entry: Entry) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  })
  clients.push(client)
  seedAccountProfileQuery(client, { id: 'user-1' })
  seedWorkspacePermissionsQuery(client, ['dataset.create_and_management'])
  seedSystemFeatures(client, { rbac_enabled: true })
  client.setQueryData(emojiCatalogOptions.queryKey, [])
  client.setQueryData(
    consoleQuery.tags.get.queryKey({ input: { query: { type: 'knowledge' } } }),
    [],
  )
  return render(
    <QueryClientTestProvider queryClient={client}>
      <NuqsTestingAdapter>
        <DatasetProvider value={{ dataset }}>
          <div style={{ width: entry === 'document-list' ? 1100 : 400, height: 700 }}>
            {entry === 'dataset-card' && <DatasetCard dataset={dataset} />}
            {entry === 'dataset-sidebar' && <DatasetDropdown expand />}
            {entry === 'template' && <TemplateCard pipeline={pipeline} type="customized" />}
            {entry === 'document-list' && (
              <DocumentList
                embeddingAvailable
                documents={[documentInfo]}
                selectedIds={[]}
                onSelectedIdChange={() => {}}
                datasetId={dataset.id}
                pagination={{ current: 1, total: 1, onChange: () => {} }}
                onUpdate={onUpdate}
                onManageMetadata={() => {}}
                remoteSortValue="-created_at"
                onSortChange={() => {}}
              />
            )}
            {entry === 'document-detail' && (
              <Operations
                embeddingAvailable
                detail={documentInfo}
                datasetId={dataset.id}
                onUpdate={onUpdate}
                scene="detail"
                canEdit
                canDownload={false}
                canDelete={false}
                canViewSettings={false}
              />
            )}
          </div>
        </DatasetProvider>
      </NuqsTestingAdapter>
    </QueryClientTestProvider>,
  )
}

beforeEach(async () => {
  await page.viewport(1280, 900)
  vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false)
  vi.clearAllMocks()
  get.mockImplementation(async (path: string) => {
    throw new Error(`Unexpected GET: ${path}`)
  })
  transport.mockImplementation(async (path: readonly string[]) => {
    throw new Error(`Unexpected Console request: ${path.join('.')}`)
  })
  post.mockResolvedValue({ result: 'success' })
  patch.mockResolvedValue({ result: 'success' })
})
afterEach(async () => {
  await cleanup()
  clients.splice(0).forEach((client) => client.clear())
  vi.unstubAllGlobals()
})

it.each([
  {
    entry: 'dataset-card',
    title: 'datasetSettings.title',
    label: 'datasetSettings.form.name',
    original: dataset.name,
  },
  {
    entry: 'dataset-sidebar',
    title: 'datasetSettings.title',
    label: 'datasetSettings.form.name',
    original: dataset.name,
  },
  {
    entry: 'template',
    title: 'datasetPipeline.editPipelineInfo',
    label: 'datasetPipeline.pipelineNameAndIcon',
    original: pipeline.name,
  },
  {
    entry: 'document-list',
    title: 'datasetDocuments.list.table.rename',
    label: 'datasetDocuments.list.table.name',
    original: documentInfo.name,
  },
  {
    entry: 'document-detail',
    title: 'datasetDocuments.list.table.rename',
    label: 'datasetDocuments.list.table.name',
    original: documentInfo.name,
  },
] as const)(
  'keeps $entry exit draft and restores a visible entry away from hover before reopening fresh',
  async ({ entry, title, label, original }) => {
    const screen = await renderOwner(entry)
    const trigger = screen.getByRole('button', {
      name:
        entry === 'dataset-card'
          ? 'Dataset operations'
          : entry === 'document-list'
            ? 'datasetDocuments.list.table.rename'
            : 'common.operation.more',
      exact: true,
    })
    const open = async () => {
      if (entry === 'dataset-card')
        await screen.getByRole('link', { name: dataset.name, exact: true }).hover()
      if (entry === 'template') await screen.getByText(pipeline.name, { exact: true }).hover()
      if (entry === 'document-list') {
        const link = screen.getByRole('link', { name: documentInfo.name, exact: true })
        for (let index = 0; index < 20 && document.activeElement !== link.element(); index++)
          await userEvent.tab()
        await expect.element(link).toHaveFocus()
        await userEvent.tab()
        await expect.element(trigger).toHaveFocus()
        await userEvent.keyboard('{Enter}')
        return
      }
      await trigger.click()
      await screen
        .getByRole('menuitem', {
          name:
            entry === 'template'
              ? 'datasetPipeline.operations.editInfo'
              : entry === 'document-detail'
                ? 'datasetDocuments.list.table.rename'
                : 'common.operation.edit',
          exact: true,
        })
        .click()
    }
    await open()
    const dialog = screen.getByRole('dialog', { name: title, exact: true })
    const input = dialog.getByRole('textbox', { name: label, exact: true })
    await input.fill('Unsaved draft')
    await dialog.getByRole('heading', { name: title }).hover()
    const popup = dialog.element()
    const inputElement = input.element() as HTMLInputElement
    await expect.poll(() => getComputedStyle(popup).opacity).toBe('1')
    const exitDraft = new Promise<boolean>((resolve) => {
      const observe = (event: Event) => {
        if (event.target !== popup || (event as TransitionEvent).propertyName !== 'opacity') return
        popup.removeEventListener('transitionrun', observe)
        resolve(popup.isConnected && inputElement.value === 'Unsaved draft')
      }
      popup.addEventListener('transitionrun', observe)
    })
    await userEvent.keyboard('{Escape}')
    expect(await exitDraft).toBe(true)
    await expect.element(dialog).not.toBeInTheDocument()
    await expect.element(trigger).toHaveFocus()
    await expect.poll(() => trigger.element().checkVisibility({ opacityProperty: true })).toBe(true)
    if (entry === 'document-list') await userEvent.keyboard('{Enter}')
    else await open()
    await expect.element(input).toHaveValue(original)
    if (entry === 'document-detail') {
      await input.fill('Renamed guide.txt')
      await userEvent.keyboard('{Enter}')
      await expect.element(dialog).not.toBeInTheDocument()
      expect(post).toHaveBeenCalledWith('/datasets/dataset-1/documents/doc-1/rename', {
        body: { name: 'Renamed guide.txt' },
      })
      expect(onUpdate).toHaveBeenCalledOnce()
      await expect.element(trigger).toHaveFocus()
    } else {
      await dialog.getByRole('button', { name: 'common.operation.cancel' }).click()
      await expect.element(dialog).not.toBeInTheDocument()
      await expect.element(trigger).toHaveFocus()
    }
  },
)
