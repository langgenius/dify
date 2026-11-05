import type { consoleClient } from '@/service/console'
import { QueryClientProvider } from '@tanstack/react-query'
import { createStore, Provider } from 'jotai'
import { queryClientAtom } from 'jotai-tanstack-query'
import { useState } from 'react'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { FeaturesProvider } from '@/app/components/base/features/context'
import WorkflowWithDefaultContext, { WorkflowWithInnerContext } from '@/app/components/workflow'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { WorkflowContext } from '@/app/components/workflow/context'
import { EditorResourceScope } from '@/app/components/workflow/editor-resource/provider'
import ZoomInOut from '@/app/components/workflow/operator/zoom-in-out'
import { createWorkflowStore } from '@/app/components/workflow/store'
import { BlockEnum } from '@/app/components/workflow/types'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { useNodesSyncDraftByCanEdit } from '../../hooks/use-nodes-sync-draft'
import { createRagPipelineSliceSlice } from '../../store'

const saveDraft = vi.hoisted(() =>
  vi.fn<typeof consoleClient.rag.pipelines.byPipelineId.workflows.draft.post>(),
)

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'rag.pipelines.byPipelineId.workflows.draft.post': saveDraft,
    }),
  }
})
vi.mock('@/service/workflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/workflow')>()),
  fetchAllInspectVars: async () => [],
}))
vi.mock('@/app/components/workflow/nodes', () => ({
  default: ({ data }: { data: { title: string } }) => (
    <div style={{ width: 200, height: 100 }}>{data.title}</div>
  ),
}))
vi.mock('@/app/components/workflow/candidate-node', () => ({ default: () => null }))
vi.mock('@/app/components/workflow/comment-manager', () => ({ default: () => null }))
vi.mock('@/app/components/workflow/comment/placement-preview', () => ({
  CommentPlacementPreview: () => null,
}))
vi.mock('@/app/components/workflow/hooks/use-workflow-comment', () => ({
  useWorkflowComment: () => ({ comments: [] }),
}))
vi.mock('@/app/components/workflow/hooks/use-workflow-search', () => ({
  useWorkflowSearch: () => {},
}))
vi.mock('@/app/components/workflow/hooks/use-locate-node', () => ({ useLocateNode: () => {} }))
vi.mock('@/app/components/workflow/hooks/use-edges-interactions', () => ({
  useEdgesInteractions: () => ({}),
}))
vi.mock('@/app/components/workflow/hooks/use-selection-interactions', () => ({
  useSelectionInteractions: () => ({ handleSelectionCancel: () => {} }),
}))
vi.mock('@/app/components/workflow/hooks/use-panel-interactions', () => ({
  usePanelInteractions: () => ({}),
}))
vi.mock('@/app/components/workflow/hooks/use-workflow-organize', () => ({
  useWorkflowOrganize: () => ({ handleLayout: () => {} }),
}))
vi.mock('@/app/components/workflow/operator', () => ({
  default: () => (
    <div style={{ position: 'absolute', bottom: 10, right: 10, zIndex: 10 }}>
      <ZoomInOut />
    </div>
  ),
}))
vi.mock('@/app/components/workflow/workflow-contextmenu', () => ({
  WorkflowContextmenu: ({ children }: { children: React.ReactNode }) => children,
}))
vi.mock(
  '@/app/components/workflow/nodes/_base/components/variable/use-match-schema-type',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('@/app/components/workflow/nodes/_base/components/variable/use-match-schema-type')
    >()),
    default: () => ({ schemaTypeDefinitions: [] }),
  }),
)
vi.mock('@/app/components/workflow/hooks/use-fetch-workflow-inspect-vars', () => ({
  useSetWorkflowVarsWithValue: () => ({ fetchInspectVars: async () => {} }),
}))

const nodes = [
  createNode({
    id: 'source',
    position: { x: 200, y: 150 },
    data: { type: BlockEnum.DataSource, title: 'File input' },
  }),
]

function PipelineCanvas() {
  const { doSyncWorkflowDraft } = useNodesSyncDraftByCanEdit(true)
  return (
    <WorkflowWithInnerContext
      nodes={nodes}
      edges={[]}
      viewport={{ x: 0, y: 0, zoom: 1 }}
      hooksStore={{ doSyncWorkflowDraft }}
    />
  )
}

function Fixture() {
  const [workflowStore] = useState(() =>
    createWorkflowStore({ injectWorkflowStoreSliceFn: createRagPipelineSliceSlice }),
  )
  const [queryClient] = useState(() => {
    const query = createConsoleQueryWrapper({
      appDslVersion: '0.6.0',
    }).queryClient
    for (const toolsQuery of [
      consoleQuery.workspaces.current.tools.builtin.get,
      consoleQuery.workspaces.current.tools.api.get,
      consoleQuery.workspaces.current.tools.workflow.get,
      consoleQuery.workspaces.current.tools.mcp.get,
    ])
      query.setQueryData(toolsQuery.queryKey(), [])
    query.setQueryData(
      consoleQuery.workspaces.current.defaultModel.get.queryKey({
        input: { query: { model_type: 'llm' } },
      }),
      { data: null },
    )
    return query
  })
  const [atoms] = useState(() => {
    const store = createStore()
    store.set(queryClientAtom, queryClient)
    return store
  })
  return (
    <QueryClientProvider client={queryClient}>
      <Provider store={atoms}>
        <EditorResourceScope resource={{ kind: 'knowledge-pipeline', pipelineId: 'pipeline-1' }}>
          <FeaturesProvider>
            <EventEmitterContextProvider>
              <WorkflowContext value={workflowStore}>
                <WorkflowWithDefaultContext nodes={nodes} edges={[]}>
                  <div style={{ width: 1000, height: 600 }}>
                    <PipelineCanvas />
                  </div>
                </WorkflowWithDefaultContext>
              </WorkflowContext>
            </EventEmitterContextProvider>
          </FeaturesProvider>
        </EditorResourceScope>
      </Provider>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  saveDraft
    .mockReset()
    .mockResolvedValue({ result: 'success', hash: 'saved-hash', updated_at: 1234 })
})

it.each([
  { control: 'workflow.operator.zoomOut', label: '83%', zoom: 1 / 1.2 },
  { control: 'workflow.operator.zoomIn', label: '120%', zoom: 1.2 },
])(
  'autosaves the pipeline viewport after $control',
  async ({ control, label, zoom }) => {
    await page.viewport(1100, 700)
    const screen = await render(<Fixture />)
    await expect.element(screen.getByRole('button', { name: '100%' })).toBeVisible()
    await screen.getByRole('button', { name: control, exact: true }).click()
    await expect.element(screen.getByRole('button', { name: label })).toBeVisible()
    await expect.poll(() => saveDraft.mock.calls.length, { timeout: 7000 }).toBe(1)
    expect(saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { pipeline_id: 'pipeline-1' },
        body: expect.objectContaining({
          graph: expect.objectContaining({ viewport: expect.objectContaining({ zoom }) }),
        }),
      }),
      expect.anything(),
    )
  },
  10_000,
)
