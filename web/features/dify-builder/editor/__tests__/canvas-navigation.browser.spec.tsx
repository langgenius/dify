import type { RefreshDraft } from './canvas-navigation-fixture'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createWorkflowAppStore as createWorkflowStore } from '@/app/components/workflow-app/__tests__/workflow-store'
import { collaborationManager } from '@/app/components/workflow/collaboration/core/collaboration-manager'
import ZoomInOut from '@/app/components/workflow/operator/zoom-in-out'
import { ControlMode } from '@/app/components/workflow/types'
import { setupFakeApi } from '@/test/fake-api'
import { draftResponse, nodes } from './canvas-navigation-data'
import { Fixture } from './canvas-navigation-fixture'

const saveDraft = vi.hoisted(() => vi.fn(async () => null))

// Keep the production canvas, node interactions, navigation controls, read-only policy and save guard.
// Node contents and unrelated editor features are outside this gesture contract.
// boundary: node bodies load per-type panels and queries; fixed-size boxes keep drag geometry real.
vi.mock('@/app/components/workflow/nodes', () => ({
  default: ({ data }: { data: { title: string } }) => (
    <div style={{ width: 200, height: 100 }}>{data.title}</div>
  ),
}))
// boundary: candidate-node placement is outside this gesture contract.
vi.mock('@/app/components/workflow/candidate-node', () => ({ default: () => null }))
// boundary: comment threads read collaboration data that this canvas does not load.
vi.mock('@/app/components/workflow/comment-manager', () => ({ default: () => null }))
// boundary: comment placement is outside this gesture contract.
vi.mock('@/app/components/workflow/comment/placement-preview', () => ({
  CommentPlacementPreview: () => null,
}))
// boundary: comment threads come from the console comment API; the canvas sees none.
vi.mock('@/app/components/workflow/hooks/use-workflow-comment', () => ({
  useWorkflowComment: () => ({ comments: [] }),
}))
// boundary: canvas search registers global shortcuts outside this gesture contract.
vi.mock('@/app/components/workflow/hooks/use-workflow-search', () => ({
  useWorkflowSearch: () => {},
}))
// boundary: node locating is outside this gesture contract.
vi.mock('@/app/components/workflow/hooks/use-locate-node', () => ({ useLocateNode: () => {} }))
// boundary: there are no edges; edge editing is outside this gesture contract.
vi.mock('@/app/components/workflow/hooks/use-edges-interactions', () => ({
  useEdgesInteractions: () => ({}),
}))
// boundary: selection editing is outside this gesture contract.
vi.mock('@/app/components/workflow/hooks/use-selection-interactions', () => ({
  useSelectionInteractions: () => ({ handleSelectionCancel: () => {} }),
}))
// boundary: side panels are not opened by these gestures.
vi.mock('@/app/components/workflow/hooks/use-panel-interactions', () => ({
  usePanelInteractions: () => ({}),
}))
// boundary: auto-layout is outside this gesture contract.
vi.mock('@/app/components/workflow/hooks/use-workflow-organize', () => ({
  useWorkflowOrganize: () => ({ handleLayout: () => {} }),
}))
// boundary: note creation writes the draft; the real add-note button state is still checked.
vi.mock('@/app/components/workflow/operator/hooks', () => ({
  useOperator: () => ({ handleAddNote: () => {} }),
}))
// boundary: the block picker loads node catalogs outside this gesture contract.
vi.mock('@/app/components/workflow/operator/add-block', () => ({ default: () => null }))
// boundary: image export renders the canvas to a file, outside this gesture contract.
vi.mock('@/app/components/workflow/operator/export-image', () => ({ ExportImage: () => null }))
// boundary: render only the real zoom control; other operator tools need the full app shell.
vi.mock('@/app/components/workflow/operator', () => ({
  default: () => (
    <div style={{ position: 'absolute', bottom: 10, right: 10, zIndex: 10 }}>
      <ZoomInOut />
    </div>
  ),
}))
// boundary: the context menu loads block catalogs that these gestures never open.
vi.mock('@/app/components/workflow/workflow-contextmenu', () => ({
  WorkflowContextmenu: ({ children }: { children: React.ReactNode }) => children,
}))
// boundary: schema type definitions come from plugin queries that this canvas does not load.
vi.mock(
  '@/app/components/workflow/nodes/_base/components/variable/use-match-schema-type',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('@/app/components/workflow/nodes/_base/components/variable/use-match-schema-type')
    >()),
    default: () => ({ schemaTypeDefinitions: [] }),
  }),
)
// boundary: the model picker loads provider catalogs; the composer itself stays real.
vi.mock('@/features/dify-builder/model/selector', () => ({
  default: () => null,
}))
// boundary: supply a selected model so the real composer is enabled without provider queries.
vi.mock('@/features/dify-builder/model/use-model', () => ({
  useDifyBuilderModel: () => ({
    model: { name: 'gpt-4o', provider: 'openai', mode: 'chat', completion_params: {} },
  }),
}))

// The recovery scenario keeps WorkflowMain, draft refresh and the actual canvas real.
// Session execution, run actions and inspect panels do not own viewport recovery.
// boundary: the Builder provider starts session execution, which does not own viewport recovery.
vi.mock('@/features/dify-builder/editor', () => ({
  DifyBuilderProvider: ({ children }: { children: React.ReactNode }) => children,
}))
// Keep the lazy Builder conversation panel outside the canvas recovery dependency graph.
// The ordinary-run scenario still renders the real composer below.
// boundary: the lazy Builder conversation panel is outside the canvas recovery dependency graph.
vi.mock('@/features/dify-builder/panel', () => ({ default: () => null }))
// boundary: run actions and inspect panels do not own viewport recovery.
vi.mock('@/app/components/workflow-app/components/workflow-children', () => ({
  default: () => null,
}))
const collaborationRuntime = vi.hoisted(() => ({
  isConnected: true,
  isEnabled: true,
  onlineUsers: [],
  startCursorTracking: vi.fn(),
  stopCursorTracking: vi.fn(),
}))
// boundary: collaboration needs a realtime connection; the test drives graph reloads directly.
vi.mock('@/app/components/workflow/collaboration/hooks/use-collaboration', () => ({
  useCollaboration: () => collaborationRuntime,
}))
// boundary: draft sync ends in a network save; the test observes the save call.
vi.mock('@/app/components/workflow-app/draft/use-draft-save', () => ({
  useWorkflowDraftSaveByCanEdit: () => ({
    doSyncWorkflowDraft: saveDraft,
    syncWorkflowDraftWhenPageClose: () => {},
    prepareWorkflowDraftForBuilder: async () => {},
    releaseWorkflowDraftFromBuilder: () => {},
  }),
}))
// boundary: the node catalog loads plugin and tool queries outside this gesture contract.
vi.mock('@/app/components/workflow/node-catalog', () => ({
  useWorkflowNodeCatalog: () => ({ nodes: [] }),
}))
// boundary: DSL export is outside this gesture contract.
vi.mock('@/app/components/workflow-app/hooks/use-DSL', () => ({
  useDSLByCanEdit: () => ({
    exportCheck: async () => {},
    handleExportDSL: async () => false,
    isExporting: false,
  }),
}))
// boundary: run and trace links need a finished run; none happens here.
vi.mock('@/app/components/workflow-app/hooks/use-get-run-and-trace-url', () => ({
  useGetRunAndTraceUrl: () => ({
    getWorkflowRunAndTraceUrl: () => ({ runUrl: '', traceUrl: '' }),
  }),
}))
// boundary: inspect-variable editing stops at the console transport; no run happens here.
vi.mock('@/app/components/workflow/hooks/use-inspect-vars-crud-common', () => ({
  useInspectVarsCrudCommon: () => ({}),
}))
// boundary: workflow runs stream from the server; the ordinary-run state is seeded in the store.
vi.mock('@/app/components/workflow-app/hooks/use-workflow-run', () => ({
  useWorkflowRunByCanEdit: () => ({}),
}))
// boundary: starting a run calls the server; the test seeds the running state instead.
vi.mock('@/app/components/workflow-app/hooks/use-workflow-start-run', () => ({
  useWorkflowStartRunByCanEdit: () => ({}),
}))
// boundary: inspect-variable reads stop at the console transport; no run has happened.
vi.mock('@/app/components/workflow/hooks/use-fetch-workflow-inspect-vars', () => ({
  useSetWorkflowVarsWithValue: () => ({ fetchInspectVars: async () => {} }),
}))

type GraphReloadCallback = (
  ...args: Parameters<Parameters<typeof collaborationManager.onGraphReloadRequired>[0]>
) => void | Promise<void>
let graphReloadCallback: GraphReloadCallback | undefined

beforeEach(() => {
  vi.restoreAllMocks()
  saveDraft.mockClear()
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

const fake = setupFakeApi({
  console: {
    apps: {
      byAppId: {
        workflow: { comments: { get: () => ({ data: [] }) } },
        workflows: {
          draft: {
            get: () => draftResponse,
            variables: { get: () => ({ items: [], total: 0 }) },
            conversationVariables: { get: () => ({ items: [] }) },
            systemVariables: { get: () => ({ items: [] }) },
          },
        },
      },
    },
  },
})

it('allows canvas navigation but blocks node movement until Builder releases its edit lock', async () => {
  // Browser-owned: native pointer dragging and React Flow's measured canvas transform.
  await page.viewport(1100, 700)
  const workflowStore = createWorkflowStore()
  const screen = await render(<Fixture saveDraft={saveDraft} workflowStore={workflowStore} />)
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
  const workflowStore = createWorkflowStore()
  let refreshDraft!: RefreshDraft
  const fetchDraft = fake.console.apps.byAppId.workflows.draft.get
  const screen = await render(
    <Fixture
      saveDraft={saveDraft}
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
  expect(await refreshDraft(false, { builderRefresh: true, resolveConflict: true })).toBe(
    'refreshed',
  )
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
  const conflict = screen.getByRole('alertdialog', { name: 'workflow.draftConflict.title' })
  await conflict.getByRole('button', { name: 'workflow.draftConflict.confirmReload' }).click()
  await expect.element(conflict).not.toBeInTheDocument()
  await expect.poll(() => recovered.element().getBoundingClientRect().x).toBeCloseTo(initial.x)
  expect(recovered.element().getBoundingClientRect().y).toBeCloseTo(initial.y)
})

it('keeps the Builder prompt focused during native wheel panning in an ordinary Test Run', async () => {
  // Real wheel events reach React Flow's move-start callback; continued typing must remain in the composer.
  await page.viewport(1100, 700)
  const screen = await render(<Fixture saveDraft={saveDraft} ordinaryRun />)
  const canvas = screen.getByRole('region', { name: 'app.types.workflow' })
  const node = screen.getByText('Start', { exact: true })
  const prompt = screen.getByRole('textbox', { name: 'difyBuilder.messagePlaceholder' })
  await expect.element(node).toBeVisible()
  await expect.element(prompt).toBeEnabled()
  const initialY = node.element().getBoundingClientRect().y
  await prompt.click()
  await expect.element(prompt).toHaveFocus()
  await canvas.wheel({ delta: { x: 0, y: 120 } })
  await expect.poll(() => node.element().getBoundingClientRect().y).toBeLessThan(initialY)
  await expect.element(prompt).toHaveFocus()
  await userEvent.keyboard('Continue editing')
  await expect.element(prompt).toHaveValue('Continue editing')
  expect(saveDraft).not.toHaveBeenCalled()
})
