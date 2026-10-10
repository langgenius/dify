import type { DataSet } from '@/models/datasets'
import type { DatasetConfigs } from '@/models/debug'
import { QueryClient } from '@tanstack/react-query'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { cleanup, render } from 'vitest-browser-react'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import AddDataset from '@/app/components/workflow/nodes/knowledge-retrieval/components/add-dataset'
import ConfigContext, { useDebugConfigurationContext } from '@/context/debug-configuration'
import { RerankingModeEnum } from '@/models/datasets'
import { consoleQuery } from '@/service/console'
import { commonQueryKeys } from '@/service/use-common'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { seedSystemFeatures } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { seedWorkspacePermissionsQuery } from '@/test/console/workspace-permissions'
import { RETRIEVE_METHOD, RETRIEVE_TYPE } from '@/types/app'
import { useDatasetSelectHandler } from '../../hooks/configuration-lifecycle/dataset'
import DatasetConfig from '../index'
import { SelectDataSet } from '../select-dataset'

const { get, transport } = vi.hoisted(() => ({ get: vi.fn(), transport: vi.fn() }))
vi.mock('@/service/console/browser', () => ({ consoleBrowserLink: { call: transport } }))
vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useParams: () => ({}),
  usePathname: () => '/app/example/configuration',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/service/base', () => ({
  get,
  post: vi.fn(),
  request: vi.fn(),
  getPublic: vi.fn(),
  getMarketplace: vi.fn(),
  postPublic: vi.fn(),
  postMarketplace: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  delPublic: vi.fn(),
  patch: vi.fn(),
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
const firstDataset: DataSet = {
  id: 'economy',
  name: 'Economy knowledge',
  indexing_status: 'completed',
  icon_info: { icon_type: 'emoji', icon: '📙', icon_background: '#FFF4ED', icon_url: '' },
  description: '',
  permission: 'all_team_members',
  data_source_type: 'upload_file',
  indexing_technique: 'economy',
  created_by: 'user-1',
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
const secondDataset: DataSet = {
  ...firstDataset,
  id: 'quality',
  name: 'Quality knowledge',
  indexing_technique: 'high_quality',
}
const savedConfig: DatasetConfigs = {
  retrieval_model: RETRIEVE_TYPE.multiWay,
  reranking_model: retrieval.reranking_model,
  top_k: 4,
  score_threshold_enabled: false,
  score_threshold: 0,
  datasets: { datasets: [] },
  reranking_enable: false,
  reranking_mode: RerankingModeEnum.RerankingModel,
}
const clients: QueryClient[] = []
const ConfigProvider = ConfigContext.Provider

function WorkflowOwner() {
  const [selected, setSelected] = useState<DataSet[]>(() => [firstDataset])
  return <AddDataset selectedIds={selected.map((item) => item.id)} onChange={setSelected} />
}

function LegacyOwner() {
  const defaults = useDebugConfigurationContext()
  const [dataSets, setDataSets] = useState<DataSet[]>(() => [firstDataset])
  const [datasetConfigs, setDatasetConfigs] = useState(() => savedConfig)
  const [selectOpen, setSelectOpen] = useState(false)
  const [rerankSettingModalOpen, setRerankSettingModalOpen] = useState(false)
  const datasetConfigsRef = { current: datasetConfigs }
  const handleSelect = useDatasetSelectHandler({
    dataSets,
    datasetConfigs,
    datasetConfigsRef,
    setDataSets,
    setDatasetConfigs,
    setRerankSettingModalOpen,
    formattingChangedDispatcher: () => {},
    hideSelectDataSet: () => setSelectOpen(false),
  })
  return (
    <ConfigProvider
      value={{
        ...defaults,
        dataSets,
        setDataSets,
        datasetConfigs,
        datasetConfigsRef,
        setDatasetConfigs,
        rerankSettingModalOpen,
        setRerankSettingModalOpen,
        showSelectDataSet: () => setSelectOpen(true),
      }}
    >
      <DatasetConfig hideMetadataFilter />
      <SelectDataSet
        open={selectOpen}
        onOpenChange={setSelectOpen}
        selectedIds={dataSets.map((item) => item.id)}
        onSelect={handleSelect}
      />
    </ConfigProvider>
  )
}

async function renderOwner(owner: 'workflow' | 'legacy') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  })
  clients.push(client)
  seedAccountProfileQuery(client, { id: 'user-1' })
  seedWorkspacePermissionsQuery(client, ['dataset.create_and_management'])
  seedSystemFeatures(client, { rbac_enabled: true })
  client.setQueryData(
    consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryKey({
      input: { params: { model_type: ModelTypeEnum.rerank } },
    }),
    { data: [] },
  )
  client.setQueryData(commonQueryKeys.defaultModel(ModelTypeEnum.rerank), { data: null })
  return render(
    <QueryClientTestProvider queryClient={client}>
      <NuqsTestingAdapter>
        <div style={{ width: 640 }}>
          {owner === 'workflow' ? <WorkflowOwner /> : <LegacyOwner />}
        </div>
      </NuqsTestingAdapter>
    </QueryClientTestProvider>,
  )
}

beforeEach(async () => {
  await page.viewport(1280, 900)
  vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false)
  get.mockReset()
  get.mockImplementation(async (path: string) => {
    if (path === '/datasets?page=1')
      return { data: [firstDataset, secondDataset], page: 1, limit: 20, total: 2, has_more: false }
    throw new Error(`Unexpected GET: ${path}`)
  })
  transport.mockReset()
  transport.mockImplementation(async (path: readonly string[]) => {
    throw new Error(`Unexpected Console request: ${path.join('.')}`)
  })
})
afterEach(async () => {
  await cleanup()
  clients.splice(0).forEach((client) => client.clear())
  vi.unstubAllGlobals()
})

it('preserves the workflow selection during exit and restores its keyboard entry before reopening fresh', async () => {
  const screen = await renderOwner('workflow')
  const entry = screen.getByRole('button', {
    name: 'common.operation.add workflow.nodes.knowledgeRetrieval.knowledge',
  })
  await userEvent.keyboard('{Tab}')
  await expect.element(entry).toHaveFocus()
  expect(get).not.toHaveBeenCalled()
  await userEvent.keyboard('{Enter}')
  const dialog = screen.getByRole('dialog', { name: 'appDebug.feature.dataSet.selectTitle' })
  await dialog.getByRole('button', { name: /Quality knowledge/ }).click()
  await expect.element(dialog.getByText('2 appDebug.feature.dataSet.selected')).toBeVisible()
  const popup = dialog.element()
  await expect.poll(() => getComputedStyle(popup).opacity).toBe('1')
  const exitingDraft = new Promise<boolean>((resolve) => {
    const observe = (event: Event) => {
      if (event.target !== popup || (event as TransitionEvent).propertyName !== 'opacity') return
      popup.removeEventListener('transitionrun', observe)
      resolve(
        popup.isConnected &&
          popup.textContent?.includes('2 appDebug.feature.dataSet.selected') === true,
      )
    }
    popup.addEventListener('transitionrun', observe)
  })
  await dialog.getByRole('heading').hover()
  await userEvent.keyboard('{Escape}')
  expect(await exitingDraft).toBe(true)
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(entry).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(dialog.getByText('1 appDebug.feature.dataSet.selected')).toBeVisible()
  await dialog.getByRole('button', { name: 'common.operation.close' }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(entry).toHaveFocus()
})

it('keeps retrieval drafts through exit and transfers accepted mixed knowledge to the real correction session', async () => {
  const screen = await renderOwner('legacy')
  const retrievalEntry = screen.getByRole('button', { name: 'dataset.retrievalSettings' })
  await retrievalEntry.click()
  const retrievalDialog = screen.getByRole('dialog', { name: 'dataset.retrievalSettings' })
  const topK = retrievalDialog.getByRole('textbox', { name: 'appDebug.datasetConfig.top_k' })
  await topK.fill('7')
  await userEvent.keyboard('{Tab}')
  await expect.element(topK).toHaveValue('7')
  const popup = retrievalDialog.element()
  const input = topK.element() as HTMLInputElement
  await expect.poll(() => getComputedStyle(popup).opacity).toBe('1')
  const exitingDraft = new Promise<boolean>((resolve) => {
    const observe = (event: Event) => {
      if (event.target !== popup || (event as TransitionEvent).propertyName !== 'opacity') return
      popup.removeEventListener('transitionrun', observe)
      resolve(popup.isConnected && input.value === '7')
    }
    popup.addEventListener('transitionrun', observe)
  })
  await retrievalDialog.getByRole('button', { name: 'common.operation.cancel' }).hover()
  await userEvent.keyboard('{Escape}')
  expect(await exitingDraft).toBe(true)
  await expect.element(retrievalDialog).not.toBeInTheDocument()
  await expect.element(retrievalEntry).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(topK).toHaveValue('4')
  await retrievalDialog.getByRole('button', { name: 'common.operation.cancel' }).click()
  await expect.element(retrievalDialog).not.toBeInTheDocument()

  const selectEntry = screen.getByRole('button', { name: 'common.operation.add', exact: true })
  await selectEntry.click()
  const selection = screen.getByRole('dialog', { name: 'appDebug.feature.dataSet.selectTitle' })
  await selection.getByRole('button', { name: /Quality knowledge/ }).click()
  await selection.getByRole('button', { name: 'common.operation.add', exact: true }).click()
  await expect.element(selection).not.toBeInTheDocument()
  await expect.element(retrievalDialog).toBeVisible()
  await expect
    .element(retrievalDialog.getByText('dataset.mixtureHighQualityAndEconomicTip'))
    .toBeVisible()
  await expect.poll(() => retrievalDialog.element().contains(document.activeElement)).toBe(true)
  await expect.element(topK).toHaveValue('4')
  await retrievalDialog.getByRole('button', { name: 'common.operation.cancel' }).click()
  await expect.element(retrievalDialog).not.toBeInTheDocument()
  await expect.element(screen.getByText('Quality knowledge', { exact: true })).toBeVisible()
  await selectEntry.click()
  await expect.element(selection.getByText('2 appDebug.feature.dataSet.selected')).toBeVisible()
})
