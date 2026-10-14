import type { Node } from '../types'
import type { DefaultModelResponse } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { QueryClientProvider } from '@tanstack/react-query'
import { createStore as createAtomStore, Provider } from 'jotai'
import { queryClientAtom } from 'jotai-tanstack-query'
import { useEffect, useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { AppModeEnum } from '@/types/app'
import DifyBuilderComposer from '../../workflow-app/components/dify-builder/composer'
import WorkflowMain from '../../workflow-app/components/workflow-main'
import { useWorkflowRefreshDraft } from '../../workflow-app/hooks/use-workflow-refresh-draft'
import { createRunningWorkflowState } from '../../workflow-app/hooks/use-workflow-run-utils'
import { collaborationManager } from '../collaboration/core/collaboration-manager'
import { WorkflowContext } from '../context'
import WorkflowWithDefaultContext, { WorkflowWithInnerContext } from '../index'
import ZoomInOut from '../operator/zoom-in-out'
import { createWorkflowStore } from '../store'
import { BlockEnum, ControlMode } from '../types'

const saveDraft = vi.hoisted(() => vi.fn(async () => null))

// Keep the production canvas, node interactions, navigation controls, read-only policy and save guard.
// Node contents and unrelated editor features are outside this gesture contract.
vi.mock('../nodes', () => ({
  default: ({ data }: { data: { title: string } }) => (
    <div style={{ width: 200, height: 100 }}>{data.title}</div>
  ),
}))
vi.mock('../candidate-node', () => ({ default: () => null }))
vi.mock('../comment-manager', () => ({ default: () => null }))
vi.mock('../comment/placement-preview', () => ({ CommentPlacementPreview: () => null }))
vi.mock('../hooks/use-workflow-comment', () => ({
  useWorkflowComment: () => ({ comments: [] }),
}))
vi.mock('../hooks/use-workflow-search', () => ({ useWorkflowSearch: () => {} }))
vi.mock('../hooks/use-locate-node', () => ({ useLocateNode: () => {} }))
vi.mock('../hooks/use-edges-interactions', () => ({
  useEdgesInteractions: () => ({}),
}))
vi.mock('../hooks/use-selection-interactions', () => ({
  useSelectionInteractions: () => ({ handleSelectionCancel: () => {} }),
}))
vi.mock('../hooks/use-panel-interactions', () => ({
  usePanelInteractions: () => ({}),
}))
vi.mock('../hooks/use-workflow-organize', () => ({
  useWorkflowOrganize: () => ({ handleLayout: () => {} }),
}))
vi.mock('../operator/hooks', () => ({
  useOperator: () => ({ handleAddNote: () => {} }),
}))
vi.mock('../operator/add-block', () => ({ default: () => null }))
vi.mock('../operator/export-image', () => ({ ExportImage: () => null }))
vi.mock('../operator', () => ({
  default: () => (
    <div style={{ position: 'absolute', bottom: 10, right: 10, zIndex: 10 }}>
      <ZoomInOut />
    </div>
  ),
}))
vi.mock('../workflow-contextmenu', () => ({
  WorkflowContextmenu: ({ children }: { children: React.ReactNode }) => children,
}))
vi.mock('../nodes/_base/components/variable/use-match-schema-type', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../nodes/_base/components/variable/use-match-schema-type')
  >()),
  default: () => ({ schemaTypeDefinitions: [] }),
}))
vi.mock('@/service/use-tools', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/use-tools')>()),
  useAllBuiltInTools: () => ({ data: [] }),
  useAllCustomTools: () => ({ data: [] }),
  useAllWorkflowTools: () => ({ data: [] }),
  useAllMCPTools: () => ({ data: [] }),
}))
vi.mock('@/service/use-workflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/use-workflow')>()),
  useConversationVarValues: () => ({ data: [] }),
  useSysVarValues: () => ({ data: [] }),
}))
vi.mock('@/service/common', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/common')>()),
  fetchDefaultModal: async () => ({
    data: {
      model: 'gpt-4o',
      model_type: ModelTypeEnum.textGeneration,
      provider: {
        provider: 'openai',
        icon_small: { en_US: '', zh_Hans: '' },
      },
    } satisfies DefaultModelResponse,
  }),
}))
vi.mock('../../workflow-app/components/dify-builder/model-selector', () => ({
  default: () => null,
}))
vi.mock('../../workflow-app/components/dify-builder/use-dify-builder-model', () => ({
  useDifyBuilderModel: () => ({
    model: { name: 'gpt-4o', provider: 'openai', mode: 'chat', completion_params: {} },
  }),
}))
const fetchDraft = vi.fn()
vi.mock('@/service/workflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/workflow')>()),
  fetchWorkflowDraft: (...args: unknown[]) => fetchDraft(...args),
  fetchAllInspectVars: async () => [],
}))

// The recovery scenario keeps WorkflowMain, draft refresh and the actual canvas real.
// Session execution, run actions and inspect panels do not own viewport recovery.
vi.mock('../../workflow-app/components/dify-builder/provider', () => ({
  DifyBuilderProvider: ({ children }: { children: React.ReactNode }) => children,
}))
// Keep the lazy Builder conversation panel outside the canvas recovery dependency graph.
// The ordinary-run scenario still renders the real composer below.
vi.mock('../../workflow-app/components/dify-builder/panel', () => ({ default: () => null }))
vi.mock('../../workflow-app/components/workflow-children', () => ({ default: () => null }))
const collaborationRuntime = vi.hoisted(() => ({
  isConnected: true,
  isEnabled: true,
  onlineUsers: [],
  startCursorTracking: vi.fn(),
  stopCursorTracking: vi.fn(),
}))
vi.mock('../collaboration/hooks/use-collaboration', () => ({
  useCollaboration: () => collaborationRuntime,
}))
vi.mock('../../workflow-app/hooks/use-nodes-sync-draft', () => ({
  useNodesSyncDraftByCanEdit: () => ({
    doSyncWorkflowDraft: saveDraft,
    syncWorkflowDraftWhenPageClose: () => {},
    prepareWorkflowDraftForBuilder: async () => {},
  }),
}))
vi.mock('../../workflow-app/hooks/use-available-nodes-meta-data', () => ({
  useAvailableNodesMetaData: () => ({ nodes: [] }),
}))
vi.mock('../../workflow-app/hooks/use-configs-map', () => ({
  useConfigsMap: () => ({
    flowId: 'builder-navigation-app',
    flowType: 'app-flow',
    fileSettings: {},
  }),
}))
vi.mock('../../workflow-app/hooks/use-DSL', () => ({
  useDSLByCanEdit: () => ({
    exportCheck: async () => {},
    handleExportDSL: async () => false,
    isExporting: false,
  }),
}))
vi.mock('../../workflow-app/hooks/use-get-run-and-trace-url', () => ({
  useGetRunAndTraceUrl: () => ({
    getWorkflowRunAndTraceUrl: () => ({ runUrl: '', traceUrl: '' }),
  }),
}))
vi.mock('../../workflow-app/hooks/use-inspect-vars-crud', () => ({
  useInspectVarsCrud: () => ({}),
}))
vi.mock('../../workflow-app/hooks/use-workflow-run', () => ({
  useWorkflowRunByCanEdit: () => ({}),
}))
vi.mock('../../workflow-app/hooks/use-workflow-start-run', () => ({
  useWorkflowStartRunByCanEdit: () => ({}),
}))
vi.mock('../hooks/use-fetch-workflow-inspect-vars', () => ({
  useSetWorkflowVarsWithValue: () => ({ fetchInspectVars: async () => {} }),
}))

const nodes: Node[] = [
  {
    id: 'start',
    type: 'custom',
    position: { x: 200, y: 150 },
    data: { type: BlockEnum.Start, title: 'Start', desc: '' },
  },
]
const viewport = { x: 0, y: 0, zoom: 1 }
const draftResponse = {
  hash: 'server-hash',
  updated_at: 1234,
  graph: { nodes, edges: [], viewport },
  environment_variables: [],
  conversation_variables: [],
}
type RefreshDraft = ReturnType<typeof useWorkflowRefreshDraft>['handleRefreshWorkflowDraft']
type GraphReloadCallback = (
  ...args: Parameters<Parameters<typeof collaborationManager.onGraphReloadRequired>[0]>
) => void | Promise<void>
let graphReloadCallback: GraphReloadCallback | undefined

function CanvasWithRefresh({
  onReady,
  collaborationRecovery = false,
}: {
  onReady?: (refresh: RefreshDraft) => void
  collaborationRecovery?: boolean
}) {
  const { handleRefreshWorkflowDraft } = useWorkflowRefreshDraft()
  useEffect(() => {
    onReady?.(handleRefreshWorkflowDraft)
  }, [handleRefreshWorkflowDraft, onReady])
  if (collaborationRecovery) return <WorkflowMain nodes={nodes} edges={[]} viewport={viewport} />

  return (
    <WorkflowWithInnerContext
      nodes={nodes}
      edges={[]}
      viewport={viewport}
      hooksStore={{ doSyncWorkflowDraft: saveDraft, handleRefreshWorkflowDraft }}
    />
  )
}

function Fixture({
  ordinaryRun = false,
  onRefreshReady,
  collaborationRecovery = false,
  workflowStore,
}: {
  ordinaryRun?: boolean
  onRefreshReady?: (refresh: RefreshDraft) => void
  collaborationRecovery?: boolean
  workflowStore?: ReturnType<typeof createWorkflowStore>
}) {
  const [store] = useState(() => {
    const workflow = workflowStore ?? createWorkflowStore({})
    workflow.setState({
      appId: 'builder-navigation-app',
      isWorkflowDataLoaded: true,
      canvasReadOnly: !ordinaryRun,
      workflowDraftSyncPhase: ordinaryRun ? 'idle' : 'builder',
      workflowRunningData: ordinaryRun ? createRunningWorkflowState() : undefined,
    })
    return workflow
  })
  const [queryClient] = useState(() => {
    const query = createConsoleQueryWrapper({
      systemFeatures: { enable_collaboration_mode: false },
      appDslVersion: '0.6.0',
    }).queryClient
    query.setQueryData(
      consoleQuery.apps.byAppId.get.queryKey({
        input: { params: { app_id: 'builder-navigation-app' } },
      }),
      createAppDetailFixture({ id: 'builder-navigation-app', mode: AppModeEnum.WORKFLOW }),
    )
    return query
  })
  const [atomStore] = useState(() => {
    const atoms = createAtomStore()
    atoms.set(queryClientAtom, queryClient)
    return atoms
  })
  return (
    <QueryClientProvider client={queryClient}>
      <Provider store={atomStore}>
        <EventEmitterContextProvider>
          <WorkflowContext value={store}>
            <WorkflowWithDefaultContext nodes={nodes} edges={[]}>
              <div style={{ display: 'flex', width: 1000, height: 600 }}>
                <div style={{ width: ordinaryRun ? 700 : 1000, height: 600 }}>
                  <CanvasWithRefresh
                    onReady={onRefreshReady}
                    collaborationRecovery={collaborationRecovery}
                  />
                </div>
                {ordinaryRun && (
                  <div style={{ width: 300 }}>
                    <DifyBuilderComposer />
                  </div>
                )}
              </div>
            </WorkflowWithDefaultContext>
          </WorkflowContext>
        </EventEmitterContextProvider>
      </Provider>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.restoreAllMocks()
  saveDraft.mockClear()
  fetchDraft.mockReset().mockResolvedValue(draftResponse)
  graphReloadCallback = undefined
  vi.spyOn(collaborationManager, 'onGraphReloadRequired').mockImplementation((callback) => {
    graphReloadCallback = callback
    return () => {
      graphReloadCallback = undefined
    }
  })
  vi.spyOn(collaborationManager, 'isGraphReloadCurrent').mockReturnValue(true)
  vi.spyOn(collaborationManager, 'replaceGraphFromReactFlow').mockReturnValue(true)
  window.localStorage.setItem('workflow-operation-mode', JSON.stringify(ControlMode.Pointer))
})

it('allows canvas navigation but blocks node movement until Builder releases its edit lock', async () => {
  // Browser-owned: native pointer dragging and React Flow's measured canvas transform.
  await page.viewport(1100, 700)
  const workflowStore = createWorkflowStore({})
  const screen = await render(<Fixture workflowStore={workflowStore} />)
  const canvas = screen.getByRole('region', { name: 'app.types.workflow' })
  const node = screen.getByText('Start', { exact: true })
  await expect.element(node).toBeVisible()
  const initial = node.element().getBoundingClientRect()

  await screen.getByRole('button', { name: 'workflow.common.handMode' }).click()
  await userEvent.dragAndDrop(canvas, canvas, {
    sourcePosition: { x: 600, y: 300 },
    targetPosition: { x: 700, y: 350 },
    steps: 5,
  })
  await expect.poll(() => node.element().getBoundingClientRect().x).toBeCloseTo(initial.x + 100)
  expect(node.element().getBoundingClientRect().y).toBeCloseTo(initial.y + 50)
  await expect.element(canvas).toHaveFocus()

  await userEvent.keyboard('{Shift>}[Digit5]{/Shift}')
  await expect
    .poll(() => node.element().getBoundingClientRect().width)
    .toBeCloseTo(initial.width / 2)
  await expect.element(screen.getByRole('button', { name: '50%' })).toBeVisible()

  await userEvent.keyboard('v')
  await expect
    .element(screen.getByRole('button', { name: 'workflow.common.pointerMode' }))
    .toHaveAttribute('aria-pressed', 'true')
  const beforeNodeDrag = node.element().getBoundingClientRect()
  await userEvent.dragAndDrop(node, canvas, {
    sourcePosition: { x: beforeNodeDrag.width / 2, y: beforeNodeDrag.height / 2 },
    targetPosition: { x: 700, y: 350 },
    steps: 5,
  })
  expect(node.element().getBoundingClientRect().x).toBeCloseTo(beforeNodeDrag.x)
  expect(node.element().getBoundingClientRect().y).toBeCloseTo(beforeNodeDrag.y)
  await expect
    .element(screen.getByRole('button', { name: 'workflow.nodes.note.addNote' }))
    .toBeDisabled()
  workflowStore.getState().flushPendingSync()
  expect(saveDraft).not.toHaveBeenCalled()

  // Use the same fixture and gesture after the Builder lock is released.
  workflowStore.getState().setCanvasReadOnly(false)
  workflowStore.getState().setWorkflowDraftSyncPhase('idle')
  await expect
    .element(screen.getByRole('button', { name: 'workflow.nodes.note.addNote' }))
    .toBeEnabled()
  await userEvent.dragAndDrop(node, canvas, {
    sourcePosition: { x: beforeNodeDrag.width / 2, y: beforeNodeDrag.height / 2 },
    targetPosition: { x: 700, y: 350 },
    steps: 5,
  })
  await expect
    .poll(() => node.element().getBoundingClientRect().x)
    .toBeGreaterThan(beforeNodeDrag.x)
  workflowStore.getState().flushPendingSync()
  expect(saveDraft).toHaveBeenCalledOnce()
})

it('preserves the manual view through collaboration recovery and still adopts the viewport on explicit reload', async () => {
  // Drive the callback registered by production WorkflowMain and measure the real React Flow transform.
  await page.viewport(1100, 700)
  const workflowStore = createWorkflowStore({})
  let refreshDraft!: RefreshDraft
  const screen = await render(
    <Fixture
      collaborationRecovery
      workflowStore={workflowStore}
      onRefreshReady={(refresh) => {
        refreshDraft = refresh
      }}
    />,
  )
  const canvas = screen.getByRole('region', { name: 'app.types.workflow' })
  const node = screen.getByText('Start', { exact: true })
  await expect.element(node).toBeVisible()
  const initial = node.element().getBoundingClientRect()
  await screen.getByRole('button', { name: 'workflow.common.handMode' }).click()
  await userEvent.dragAndDrop(canvas, canvas, {
    sourcePosition: { x: 600, y: 300 },
    targetPosition: { x: 700, y: 350 },
    steps: 5,
  })
  await expect.poll(() => node.element().getBoundingClientRect().x).toBeCloseTo(initial.x + 100)
  expect(await refreshDraft(false, { builderRefresh: true, resolveConflict: true })).toBe(true)
  // CanvasLockSync releases this lock when the Builder session has completed.
  workflowStore.getState().setCanvasReadOnly(false)
  const moved = node.element().getBoundingClientRect()
  fetchDraft.mockResolvedValue({
    ...draftResponse,
    hash: 'recovered-hash',
    graph: {
      ...draftResponse.graph,
      nodes: nodes.map((item) => ({ ...item, data: { ...item.data, title: 'Recovered Start' } })),
    },
  })

  await expect.poll(() => graphReloadCallback).toBeTypeOf('function')
  const request = { generation: 2, token: 1, attempt: 0 }
  await graphReloadCallback!(request)
  const recovered = screen.getByText('Recovered Start', { exact: true })
  await expect.element(recovered).toBeVisible()
  expect(recovered.element().getBoundingClientRect().x).toBeCloseTo(moved.x)
  expect(recovered.element().getBoundingClientRect().y).toBeCloseTo(moved.y)
  expect(collaborationManager.replaceGraphFromReactFlow).toHaveBeenCalledWith(request)

  workflowStore.getState().setWorkflowDraftConflict(true)
  await screen.getByRole('button', { name: 'workflow.draftConflict.reload' }).click()
  await expect.poll(() => recovered.element().getBoundingClientRect().x).toBeCloseTo(initial.x)
  expect(recovered.element().getBoundingClientRect().y).toBeCloseTo(initial.y)
})

it('preserves the manually panned view on a visibility refresh after Builder finishes', async () => {
  // Native pan and the production refresh/update pipeline prove that new graph data can arrive without moving the view.
  await page.viewport(1100, 700)
  let refreshDraft!: RefreshDraft
  const screen = await render(
    <Fixture
      onRefreshReady={(refresh) => {
        refreshDraft = refresh
      }}
    />,
  )
  const canvas = screen.getByRole('region', { name: 'app.types.workflow' })
  const node = screen.getByText('Start', { exact: true })
  await expect.element(node).toBeVisible()
  const initial = node.element().getBoundingClientRect()
  await screen.getByRole('button', { name: 'workflow.common.handMode' }).click()
  await userEvent.dragAndDrop(canvas, canvas, {
    sourcePosition: { x: 600, y: 300 },
    targetPosition: { x: 700, y: 350 },
    steps: 5,
  })
  await expect.poll(() => node.element().getBoundingClientRect().x).toBeCloseTo(initial.x + 100)

  expect(await refreshDraft(false, { builderRefresh: true, resolveConflict: true })).toBe(true)
  await expect.poll(() => node.element().getBoundingClientRect().x).toBeCloseTo(initial.x + 100)
  const moved = node.element().getBoundingClientRect()
  fetchDraft.mockResolvedValueOnce({
    ...draftResponse,
    graph: {
      ...draftResponse.graph,
      nodes: nodes.map((item) => ({ ...item, data: { ...item.data, title: 'Refreshed Start' } })),
    },
  })
  expect(document.visibilityState).toBe('visible')
  document.dispatchEvent(new Event('visibilitychange'))
  const refreshedNode = screen.getByText('Refreshed Start', { exact: true })
  await expect.element(refreshedNode).toBeVisible()
  expect(fetchDraft).toHaveBeenCalledTimes(2)
  expect(refreshedNode.element().getBoundingClientRect().x).toBeCloseTo(moved.x)
  expect(refreshedNode.element().getBoundingClientRect().y).toBeCloseTo(moved.y)

  // An explicit reload still adopts the saved draft viewport.
  expect(await refreshDraft()).toBe(true)
  await expect.poll(() => node.element().getBoundingClientRect().x).toBeCloseTo(initial.x)
  expect(node.element().getBoundingClientRect().y).toBeCloseTo(initial.y)
})

it('keeps the Builder prompt focused during native wheel zoom in an ordinary Test Run', async () => {
  // Real wheel events reach React Flow's move-start callback; continued typing must remain in the composer.
  await page.viewport(1100, 700)
  const screen = await render(<Fixture ordinaryRun />)
  const canvas = screen.getByRole('region', { name: 'app.types.workflow' })
  const node = screen.getByText('Start', { exact: true })
  const prompt = screen.getByRole('textbox', { name: 'difyBuilder.messagePlaceholder' })
  await expect.element(node).toBeVisible()
  await expect.element(prompt).toBeEnabled()
  const initialWidth = node.element().getBoundingClientRect().width
  await prompt.click()
  await expect.element(prompt).toHaveFocus()
  await canvas.wheel({ delta: { x: 0, y: 120 } })
  await expect.poll(() => node.element().getBoundingClientRect().width).toBeLessThan(initialWidth)
  await expect.element(prompt).toHaveFocus()
  await userEvent.keyboard('Continue editing')
  await expect.element(prompt).toHaveValue('Continue editing')
  expect(saveDraft).not.toHaveBeenCalled()
})
