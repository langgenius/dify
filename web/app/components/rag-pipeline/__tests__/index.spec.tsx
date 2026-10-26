import type { Viewport } from 'reactflow'
import type { FetchWorkflowDraftResponse } from '@/types/workflow'
import { act, screen } from '@testing-library/react'
import { createEdge, createNode } from '@/app/components/workflow/__tests__/fixtures'
import { WorkflowInitializationProbe } from '@/app/components/workflow/__tests__/workflow-initialization-probe'
import knowledgeBaseDefault from '@/app/components/workflow/nodes/knowledge-base/default'
import { BlockEnum } from '@/app/components/workflow/types'
import DatasetDetailContext from '@/context/dataset-detail'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { createFileUploadConfigFixture } from '@/test/fixtures/file-upload-config'
import RagPipelineWrapper from '../index'

const requests = vi.hoisted(() => ({
  draft: vi.fn<typeof import('@/service/workflow').fetchWorkflowDraft>(),
}))
vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useParams: () => ({ datasetId: 'dataset-1' }),
}))
vi.mock('@/service/workflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/workflow')>()),
  fetchWorkflowDraft: requests.draft,
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'rag.pipelines.byPipelineId.workflows.defaultWorkflowBlockConfigs.get': async () => [],
      'rag.pipelines.byPipelineId.workflows.publish.get': async () => null,
      'files.upload.get': async () => createFileUploadConfigFixture(),
      'rag.pipelines.datasourcePlugins.get': async () => [],
    }),
  }
})

// Full pipeline editing has its own suite; retain the real initialization/provider boundary.
vi.mock('../components/rag-pipeline-main', () => ({
  default: ({ viewport }: { viewport: Viewport }) => (
    <>
      <WorkflowInitializationProbe />
      <output aria-label="Initial viewport">{JSON.stringify(viewport)}</output>
    </>
  ),
}))

const draft = (): FetchWorkflowDraftResponse => ({
  id: 'draft-1',
  graph: {
    nodes: [
      createNode({
        id: 'source',
        data: {
          type: BlockEnum.DataSource,
          title: 'Local files',
          plugin_id: 'langgenius/file',
          provider_type: 'local_file',
          provider_name: 'file',
          datasource_name: 'local-file',
          datasource_label: 'Local files',
          datasource_parameters: {},
          datasource_configurations: {},
        },
      }),
      createNode({
        id: 'knowledge',
        data: {
          ...knowledgeBaseDefault.defaultValue,
          type: BlockEnum.KnowledgeBase,
          title: 'Knowledge',
        },
      }),
    ],
    edges: [createEdge({ source: 'source', target: 'knowledge' })],
    viewport: { x: 80, y: 40, zoom: 1.5 },
  },
  hash: 'draft-hash',
  created_at: 1_712_300_000,
  updated_at: 1_712_345_678,
  created_by: { id: 'user-1', name: 'User', email: 'user@example.com' },
  updated_by: { id: 'user-1', name: 'User', email: 'user@example.com' },
  tool_published: false,
  version: 'draft',
  marked_name: '',
  marked_comment: '',
})

const renderPipeline = (pipelineId: string | null = 'pipeline-1') => {
  const DatasetProvider = DatasetDetailContext.Provider
  return renderWithConsoleQuery(
    <DatasetProvider value={{ dataset: createDatasetFixture({ pipeline_id: pipelineId }) }}>
      <RagPipelineWrapper />
    </DatasetProvider>,
  )
}

beforeEach(() => requests.draft.mockReset().mockResolvedValue(draft()))

const expectGraph = async () => {
  expect(await screen.findByRole('status', { name: 'Initialized nodes' })).toHaveTextContent(
    'source:Local files,knowledge:Knowledge',
  )
  expect(screen.getByRole('status', { name: 'Initialized edges' })).toHaveTextContent(
    'source->knowledge',
  )
  expect(screen.getByRole('status', { name: 'Initial viewport' })).toHaveTextContent(
    JSON.stringify({ x: 80, y: 40, zoom: 1.5 }),
  )
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
}

describe('RagPipeline', () => {
  it('offers conversion when the dataset has no pipeline', () => {
    renderPipeline(null)
    expect(
      screen.getByRole('button', { name: 'datasetPipeline.operations.convert' }),
    ).toBeInTheDocument()
    expect(requests.draft).not.toHaveBeenCalled()
  })
  it('keeps the editor gated until the pipeline draft arrives', async () => {
    const pending = createDeferred<FetchWorkflowDraftResponse>()
    requests.draft.mockReturnValue(pending.promise)
    renderPipeline()
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: 'Initialized nodes' })).not.toBeInTheDocument()
    await act(async () => pending.resolve(draft()))
    await expectGraph()
  })
  it('loads the dataset pipeline into the real workflow provider', async () => {
    renderPipeline()
    await expectGraph()
    expect(requests.draft).toHaveBeenCalledExactlyOnceWith(
      '/rag/pipelines/pipeline-1/workflows/draft',
    )
  })
})
