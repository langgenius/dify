import type { WorkflowCommentDetail } from '@dify/contracts/api/console/apps/types.gen'
import type { RefObject } from 'react'
import type { ReactFlowInstance } from 'reactflow'
import type { Shape as HooksStoreShape } from '../hooks-store'
import type { WorkflowProps } from '../index'
import type { Shape } from '../store'
import type { EventEmitterValue } from '@/context/event-emitter'
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EventEmitter } from 'ahooks/lib/useEventEmitter'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRef, useImperativeHandle } from 'react'
import { useReactFlow } from 'reactflow'
import { toast } from '@/app/notifications'
import { EventEmitterContext } from '@/context/event-emitter'
import { consoleQuery } from '@/service/console'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper, seedAppDslVersion } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import { collaborationManager } from '../collaboration/core/collaboration-manager'
import { WORKFLOW_DATA_UPDATE } from '../constants'
import WorkflowWithDefaultContext, { Workflow } from '../index'
import codeNodeDefault from '../nodes/code/default'
import { BlockEnum } from '../types'
import { createEdge, createNode } from './fixtures'
import { renderWorkflowComponent } from './workflow-test-env'

const api = vi.hoisted(() => ({
  comments:
    vi.fn<typeof import('@/service/console').consoleClient.apps.byAppId.workflow.comments.get>(),
  comment:
    vi.fn<
      typeof import('@/service/console').consoleClient.apps.byAppId.workflow.comments.byCommentId.get
    >(),
  deleteComment:
    vi.fn<
      typeof import('@/service/console').consoleClient.apps.byAppId.workflow.comments.byCommentId.delete
    >(),
  deleteReply:
    vi.fn<
      typeof import('@/service/console').consoleClient.apps.byAppId.workflow.comments.byCommentId.replies.byReplyId.delete
    >(),
}))
vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useParams: () => ({ appId: 'app-1' }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/app/app-1/workflow',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'apps.byAppId.workflow.comments.get': api.comments,
      'apps.byAppId.workflows.draft.variables.get': async () => ({ items: [], total: 0 }),
      'apps.byAppId.workflow.comments.mentionUsers.get': async () => ({ users: [] }),
      'apps.byAppId.workflow.comments.byCommentId.get': api.comment,
      'apps.byAppId.workflow.comments.byCommentId.delete': api.deleteComment,
      'apps.byAppId.workflow.comments.byCommentId.replies.byReplyId.delete': api.deleteReply,
    }),
  }
})

const WorkflowEventProvider = EventEmitterContext.Provider
const nodes = [
  createNode({
    id: 'code',
    data: { ...codeNodeDefault.defaultValue, title: 'Transform documents' },
  }),
]
type Manager = typeof collaborationManager
const events = {
  graph: new Set<Parameters<Manager['onGraphImport']>[0]>(),
  history: new Set<Parameters<Manager['onHistoryAction']>[0]>(),
  restore: new Set<Parameters<Manager['onRestoreIntent']>[0]>(),
}

beforeEach(() => {
  for (const listeners of Object.values(events)) listeners.clear()
  vi.spyOn(collaborationManager, 'canFlushGraphOnPageClose').mockReturnValue(true)
  vi.spyOn(collaborationManager, 'canUseLocalDraftFallback').mockReturnValue(false)
  vi.spyOn(collaborationManager, 'onGraphImport').mockImplementation((handler) => {
    events.graph.add(handler)
    return () => {
      events.graph.delete(handler)
    }
  })
  vi.spyOn(collaborationManager, 'onHistoryAction').mockImplementation((handler) => {
    events.history.add(handler)
    return () => {
      events.history.delete(handler)
    }
  })
  vi.spyOn(collaborationManager, 'onRestoreIntent').mockImplementation((handler) => {
    events.restore.add(handler)
    return () => {
      events.restore.delete(handler)
    }
  })
  vi.spyOn(collaborationManager, 'emitCommentsUpdate').mockImplementation(() => {})
  vi.spyOn(toast, 'info').mockImplementation(() => '')
  vi.spyOn(toast, 'error').mockImplementation(() => '')
  api.comments.mockReset().mockResolvedValue({ data: [] })
  api.comment.mockReset()
  api.deleteComment.mockReset().mockResolvedValue({ result: 'success' })
  api.deleteReply.mockReset().mockResolvedValue({ result: 'success' })
})
afterEach(async () => {
  await act(async () => cleanup())
  vi.restoreAllMocks()
})

function GraphApi({ apiRef }: { apiRef: RefObject<ReactFlowInstance | null> }) {
  const instance = useReactFlow()
  useImperativeHandle(apiRef, () => instance, [instance])
  return null
}

function renderSubject({
  initialStoreState,
  graphNodes = nodes,
  edges = [],
  isCollaborationEnabled = false,
}: {
  initialStoreState?: Partial<Shape>
  isCollaborationEnabled?: boolean
  graphNodes?: WorkflowProps['nodes']
  edges?: WorkflowProps['edges']
} = {}) {
  const { queryClient } = createConsoleQueryWrapper({
    systemFeatures: { enable_collaboration_mode: true },
  })
  seedAppDslVersion(queryClient)
  seedModelProviderQueries(queryClient)
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])
  queryClient.setQueryData(consoleQuery.workspaces.current.agentProviders.get.queryKey(), [])
  queryClient.setQueryData(consoleQuery.workspaces.current.triggers.get.queryKey({ input: {} }), [])
  const eventEmitter = new EventEmitter<EventEmitterValue>()
  const graph = createRef<ReactFlowInstance>()
  // Workflow's host supplies persistence through this public hooks-store contract.
  const saveDraft = vi.fn<HooksStoreShape['doSyncWorkflowDraft']>().mockResolvedValue(undefined)
  const saveOnClose = vi.fn<HooksStoreShape['syncWorkflowDraftWhenPageClose']>()
  const subject = (props: Partial<WorkflowProps> = {}) => (
    <NuqsTestingAdapter>
      <WorkflowEventProvider value={{ eventEmitter }}>
        <WorkflowWithDefaultContext nodes={graphNodes} edges={edges}>
          <Workflow
            nodes={graphNodes}
            edges={edges}
            isCollaborationEnabled={isCollaborationEnabled}
            {...props}
          >
            <GraphApi apiRef={graph} />
          </Workflow>
        </WorkflowWithDefaultContext>
      </WorkflowEventProvider>
    </NuqsTestingAdapter>
  )
  const view = renderWorkflowComponent(subject(), {
    queryClient,
    initialStoreState,
    hooksStoreProps: {
      doSyncWorkflowDraft: saveDraft,
      syncWorkflowDraftWhenPageClose: saveOnClose,
    },
  })
  return { ...view, eventEmitter, saveDraft, saveOnClose, subject, graph }
}

it('opens the node context menu and clears its target when the graph is replaced', async () => {
  const { store, eventEmitter } = renderSubject()
  fireEvent.contextMenu(screen.getByText('Transform documents'), { clientX: 24, clientY: 48 })
  expect(store.getState().contextMenuTarget).toMatchObject({ type: 'node', nodeId: 'code' })
  expect(await screen.findByRole('menu')).toBeInTheDocument()
  act(() =>
    eventEmitter.emit({
      type: WORKFLOW_DATA_UPDATE,
      payload: {
        nodes: [
          createNode({
            id: 'imported',
            data: { ...codeNodeDefault.defaultValue, title: 'Imported graph' },
          }),
        ],
        edges: [],
      },
    }),
  )
  expect(store.getState().contextMenuTarget).toBeUndefined()
  expect(screen.getByText('Imported graph')).toBeInTheDocument()
  expect(screen.queryByText('Transform documents')).not.toBeInTheDocument()
})

it('reports a persistent error when the final save fails', async () => {
  const { saveDraft, unmount } = renderSubject({
    initialStoreState: { isWorkflowDataLoaded: true },
  })
  saveDraft.mockImplementation(async (_skipRefresh, callback) => callback?.onError?.())
  await act(async () => unmount())
  expect(toast.error).toHaveBeenCalledWith('workflow.common.draftSaveFailed', { timeout: 0 })
})

it('cancels the queued debounce and saves exactly once on unmount', async () => {
  const { store, saveDraft, unmount } = renderSubject({
    initialStoreState: { isWorkflowDataLoaded: true },
  })
  vi.useFakeTimers()
  try {
    store.getState().debouncedSyncWorkflowDraft(saveDraft)
    await act(async () => unmount())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(saveDraft).toHaveBeenCalledExactlyOnceWith(
      true,
      expect.objectContaining({ onError: expect.any(Function) }),
    )
  } finally {
    vi.useRealTimers()
  }
})

it('does not save before data loads or merely because collaboration props change', async () => {
  const { store, rerender, subject, saveDraft, saveOnClose, unmount } = renderSubject()
  rerender(subject({ isCollaborationEnabled: true }))
  expect(saveDraft).not.toHaveBeenCalled()
  expect(saveOnClose).not.toHaveBeenCalled()
  await act(async () => unmount())
  expect(store.getState().isWorkflowDataLoaded).toBe(false)
  expect(saveDraft).not.toHaveBeenCalled()
  expect(saveOnClose).not.toHaveBeenCalled()
})

it('keeps loaded edits unsaved during rerenders, then flushes on actual exit', async () => {
  const { rerender, subject, saveDraft, unmount } = renderSubject({
    initialStoreState: { isWorkflowDataLoaded: true },
  })
  rerender(subject({ isCollaborationEnabled: true }))
  expect(saveDraft).not.toHaveBeenCalled()
  await act(async () => unmount())
  expect(saveDraft).toHaveBeenCalledTimes(1)
})

it.each([
  { name: 'current graph leader', canFlush: true, fallback: false, localSaves: 0, saves: 1 },
  {
    name: 'local draft before first connection',
    canFlush: false,
    fallback: true,
    localSaves: 1,
    saves: 0,
  },
  {
    name: 'session without flush permission',
    canFlush: false,
    fallback: false,
    localSaves: 0,
    saves: 0,
  },
])(
  'uses the safe persistence path for a $name',
  async ({ canFlush, fallback, localSaves, saves }) => {
    vi.mocked(collaborationManager.canFlushGraphOnPageClose).mockReturnValue(canFlush)
    vi.mocked(collaborationManager.canUseLocalDraftFallback).mockReturnValue(fallback)
    const { saveDraft, saveOnClose, unmount } = renderSubject({
      isCollaborationEnabled: true,
      initialStoreState: { isWorkflowDataLoaded: true },
    })
    await act(async () => unmount())
    expect(saveOnClose).toHaveBeenCalledTimes(localSaves)
    expect(saveDraft).toHaveBeenCalledTimes(saves)
  },
)

it('cancels the host confirmation without executing its action', async () => {
  const user = userEvent.setup()
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  const { store } = renderSubject({
    initialStoreState: {
      showConfirm: {
        title: 'Delete selected nodes',
        desc: 'Their connections will also be removed',
        onConfirm,
        onCancel,
      },
    },
  })
  expect(screen.getByRole('alertdialog')).toHaveTextContent(
    'Their connections will also be removed',
  )
  await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  expect(store.getState().showConfirm).toBeUndefined()
  expect(onCancel).toHaveBeenCalledTimes(1)
  expect(onConfirm).not.toHaveBeenCalled()
})

it('executes the host action after confirmation', async () => {
  const user = userEvent.setup()
  const onConfirm = vi.fn()
  renderSubject({
    initialStoreState: { showConfirm: { title: 'Delete selected nodes', onConfirm } },
  })
  await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))
  expect(onConfirm).toHaveBeenCalledTimes(1)
})

it('applies imported collaboration graphs and announces remote history actions', () => {
  renderSubject()
  act(() => {
    for (const handler of [...events.graph])
      handler({
        nodes: [
          createNode({
            id: 'remote',
            data: { ...codeNodeDefault.defaultValue, title: 'Remote graph' },
          }),
        ],
        edges: [],
      })
    for (const handler of events.history) handler({ action: 'undo' })
  })
  expect(screen.getByText('Remote graph')).toBeInTheDocument()
  expect(screen.queryByText('Transform documents')).not.toBeInTheDocument()
  expect(toast.info).toHaveBeenCalledExactlyOnceWith('workflow.collaboration.historyAction.generic')
})

it('announces who is restoring the remote workflow version', () => {
  renderSubject()
  act(() => {
    for (const handler of events.restore)
      handler({
        versionId: 'version-1',
        versionName: 'Version One',
        initiatorUserId: 'peer',
        initiatorName: 'Alice',
      })
  })
  expect(toast.info).toHaveBeenCalledWith(
    'workflowHistory.versionHistory.action.restoreInProgress:{"userName":"Alice","versionName":"Version One"}',
  )
})

function comment(id: string, name: string, resolved = false): WorkflowCommentDetail {
  return {
    id,
    position_x: 10,
    position_y: 20,
    content: `Review by ${name}`,
    created_by: id,
    created_by_account: { id, name, email: `${id}@example.com`, avatar_url: null },
    created_at: 100,
    updated_at: 100,
    resolved,
    mentions: [],
    replies: [],
  }
}

it('navigates unresolved comments and deletes a thread only after confirmation', async () => {
  const user = userEvent.setup()
  const first = comment('user-1', 'Alice')
  const resolved = comment('resolved', 'Resolved author', true)
  const last = comment('last', 'Last author')
  let comments = [first, resolved, last]
  api.comments.mockImplementation(async () => ({
    data: comments.map((item) => ({ ...item, mention_count: 0, reply_count: 0, participants: [] })),
  }))
  api.comment.mockImplementation(async ({ params }) =>
    comments.find((item) => item.id === params.comment_id)!,
  )
  api.deleteComment.mockImplementation(async ({ params }) => {
    comments = comments.filter((item) => item.id !== params.comment_id)
    return { result: 'success' }
  })
  renderSubject({ initialStoreState: { showUserComments: true, showResolvedComments: false } })
  await user.click(
    await screen.findByRole('button', { name: 'workflow.keyboard.openComment:{"name":"Alice"}' }),
  )
  const thread = await screen.findByRole('dialog', { name: 'workflowComments.comments.panelTitle' })
  expect(thread).toHaveTextContent('Review by Alice')
  expect(
    screen.queryByRole('button', { name: /openComment.*Resolved author/ }),
  ).not.toBeInTheDocument()
  await user.click(
    within(thread).getByRole('button', { name: 'workflowComments.comments.aria.nextComment' }),
  )
  await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent('Review by Last author'))
  await user.click(
    screen.getByRole('button', { name: 'workflowComments.comments.aria.previousComment' }),
  )
  await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent('Review by Alice'))
  await user.click(
    screen.getByRole('button', { name: 'workflowComments.comments.aria.deleteComment' }),
  )
  expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  expect(api.deleteComment).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
  expect(api.deleteComment).not.toHaveBeenCalled()
  await user.click(
    screen.getByRole('button', { name: 'workflowComments.comments.aria.deleteComment' }),
  )
  await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))
  await waitFor(() =>
    expect(api.deleteComment).toHaveBeenCalledExactlyOnceWith({
      params: { app_id: 'app-1', comment_id: 'user-1' },
    }),
  )
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'workflow.keyboard.openComment:{"name":"Alice"}' }),
    ).not.toBeInTheDocument(),
  )
})

it('deletes a reply through the real thread confirmation and refreshes its content', async () => {
  const user = userEvent.setup()
  const detail = comment('user-1', 'Alice')
  detail.replies = [
    {
      id: 'reply-1',
      content: 'Remove this reply',
      created_by: 'user-1',
      created_by_account: detail.created_by_account,
      created_at: 101,
    },
  ]
  api.comments.mockImplementation(async () => ({
    data: [{ ...detail, mention_count: 0, reply_count: detail.replies.length, participants: [] }],
  }))
  api.comment.mockImplementation(async () => ({ ...detail, replies: [...detail.replies] }))
  api.deleteReply.mockImplementation(async () => {
    detail.replies = []
    return { result: 'success' }
  })
  renderSubject({ initialStoreState: { showUserComments: true } })
  await user.click(
    await screen.findByRole('button', { name: 'workflow.keyboard.openComment:{"name":"Alice"}' }),
  )
  expect(await screen.findByText('Remove this reply')).toBeInTheDocument()
  await user.click(
    screen.getByRole('button', { name: 'workflowComments.comments.aria.replyActions' }),
  )
  await user.click(
    await screen.findByRole('menuitem', { name: 'workflowComments.comments.actions.deleteReply' }),
  )
  expect(api.deleteReply).not.toHaveBeenCalled()
  await user.click(await screen.findByRole('button', { name: 'common.operation.delete' }))
  await waitFor(() =>
    expect(api.deleteReply).toHaveBeenCalledExactlyOnceWith({
      params: { app_id: 'app-1', comment_id: 'user-1', reply_id: 'reply-1' },
    }),
  )
  await waitFor(() => expect(screen.queryByText('Remove this reply')).not.toBeInTheDocument())
})

it('deletes a selected connection only inside the canvas while preserving its endpoints', async () => {
  const user = userEvent.setup()
  const graphNodes = [
    createNode({
      id: 'source',
      data: { ...codeNodeDefault.defaultValue, _connectedSourceHandleIds: ['source'] },
    }),
    createNode({
      id: 'target',
      position: { x: 400, y: 0 },
      data: { ...codeNodeDefault.defaultValue, _connectedTargetHandleIds: ['target'] },
    }),
  ]
  const edge = createEdge({
    id: 'connection',
    source: 'source',
    target: 'target',
    sourceHandle: 'source',
    targetHandle: 'target',
    selected: true,
    data: { sourceType: BlockEnum.Code, targetType: BlockEnum.Code },
  })
  const { graph } = renderSubject({ graphNodes, edges: [edge] })
  // Public React Flow state proves the graph mutation without inventing handle geometry in happy-dom.
  expect(graph.current!.getEdges()).toEqual([edge])
  await user.keyboard('{Delete}')
  expect(graph.current!.getEdges()).toEqual([edge])
  act(() => screen.getByRole('region', { name: 'app.types.workflow' }).focus())
  await user.keyboard('{Delete}')
  await waitFor(() => expect(graph.current!.getEdges()).toEqual([]))
  expect(graph.current!.getNodes().map((node) => node.id)).toEqual(['source', 'target'])
})
