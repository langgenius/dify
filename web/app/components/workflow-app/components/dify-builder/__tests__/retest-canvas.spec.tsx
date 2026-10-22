import type { ReactNode } from 'react'
import type { WorkflowDraftRefreshResult } from '../../../hooks/use-workflow-refresh-draft'
import type { Node } from '@/app/components/workflow/types'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider, useAtomValue, useStore } from 'jotai'
import { queryClientAtom } from 'jotai-tanstack-query'
import { useCallback } from 'react'
import ReactFlow, { ReactFlowProvider, useStoreApi } from 'reactflow'
import { WorkflowContext } from '@/app/components/workflow/context'
import { createWorkflowStore } from '@/app/components/workflow/store'
import { BlockEnum } from '@/app/components/workflow/types'
import { createConsoleQueryClient } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { DifyBuilderCanvasRefreshSync } from '../provider/canvas-sync'
import { useDifyBuilderRunEvents } from '../provider/use-run-events'
import {
  commandStartedEvent,
  conversationPage,
  createSessionView,
  stateEvent,
  streamOf,
} from '../session/__tests__/fixtures'
import { difyBuilderActiveSessionIdAtom, difyBuilderSessionViewAtom } from '../session/state'
import { useDifyBuilderSessionController } from '../session/use-session-controller'
import {
  difyBuilderCanvasReadyAtom,
  difyBuilderCanvasRefreshFailedAtom,
  difyBuilderRetryCanvasRefreshAtom,
} from '../store'
import {
  nodeFinished,
  nodeStarted,
  runFinished,
  runStarted,
  workflowEvent,
} from './workflow-fixtures'

const mocks = vi.hoisted(() => ({ action: vi.fn(), conversation: vi.fn(), graphApplied: vi.fn() }))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  return {
    ...actual,
    consoleClient: {
      ...actual.consoleClient,
      difyBuilder: {
        sessions: {
          bySessionId: {
            actions: { post: mocks.action },
            conversation: { get: mocks.conversation },
          },
        },
      },
    },
  }
})

const Harness = ({
  repairRefresh,
}: {
  repairRefresh: () => Promise<WorkflowDraftRefreshResult>
}) => {
  const store = useStore()
  const canvas = useStoreApi()
  const events = useDifyBuilderRunEvents('app-1')
  const session = useDifyBuilderSessionController(undefined, events)
  const ready = useAtomValue(difyBuilderCanvasReadyAtom)
  const refresh = useCallback(
    async (shouldApply: () => boolean) => {
      const version = store.get(difyBuilderSessionViewAtom)!.version
      if (version === 2) {
        const refreshed = await repairRefresh()
        if (refreshed !== 'refreshed') return refreshed
      }
      if (!shouldApply()) return 'superseded' as const
      const nodes: Node[] = (version === 1 ? ['start'] : ['start', 'answer']).map((id) => ({
        id,
        position: { x: 0, y: 0 },
        width: 200,
        height: 80,
        data: { title: id, type: BlockEnum.Code, desc: '' },
      }))
      canvas.getState().setNodes(nodes)
      if (version === 2) mocks.graphApplied()
      return 'refreshed' as const
    },
    [canvas, repairRefresh, store],
  )
  return (
    <>
      <button
        type="button"
        disabled={!ready}
        onClick={() => void session.runAction('approve_plan')}
      >
        Apply repair
      </button>
      <button type="button" onClick={() => store.set(difyBuilderRetryCanvasRefreshAtom)}>
        Resync canvas
      </button>
      <button type="button" onClick={session.onCanvasRefreshed}>
        Canvas refreshed
      </button>
      <DifyBuilderCanvasRefreshSync
        onRefreshCanvas={refresh}
        onCanvasRefreshed={session.onCanvasRefreshed}
      />
    </>
  )
}

describe('Builder repair graph and test run', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.conversation.mockResolvedValue(conversationPage())
  })

  it('keeps a preparing Builder command alive through canvas initialization and aborts it on unmount', async () => {
    const store = createStore()
    store.set(difyBuilderSessionViewAtom, createSessionView())
    const workflow = createWorkflowStore({})
    const queryClient = createConsoleQueryClient()
    let showCanvas = false
    let releasePreparation!: () => void
    let signal: AbortSignal | undefined
    const prepare = (_saveDraft: boolean, nextSignal: AbortSignal) => {
      signal = nextSignal
      return new Promise<void>((resolve) => {
        releasePreparation = resolve
      })
    }
    const hook = renderHook(
      () => {
        const events = useDifyBuilderRunEvents('app-1')
        return useDifyBuilderSessionController(prepare, events)
      },
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={queryClient}>
            <Provider store={store}>
              <WorkflowContext value={workflow}>
                <ReactFlowProvider>
                  {children}
                  {showCanvas && (
                    <div style={{ width: 800, height: 600 }}>
                      <ReactFlow defaultNodes={[]} defaultEdges={[]} />
                    </div>
                  )}
                </ReactFlowProvider>
              </WorkflowContext>
            </Provider>
          </QueryClientProvider>
        ),
      },
    )
    let command!: Promise<boolean>
    act(() => {
      command = hook.result.current.runAction('run_test')
    })
    try {
      expect(signal?.aborted).toBe(false)
      showCanvas = true
      hook.rerender()
      expect(signal?.aborted).toBe(false)
      expect(mocks.action).not.toHaveBeenCalled()
    } finally {
      hook.unmount()
      releasePreparation()
      expect(await command).toBe(false)
    }
    expect(signal?.aborted).toBe(true)
    expect(mocks.action).not.toHaveBeenCalled()
  })

  it.each(['refreshed', 'failed', 'superseded', 'manual retry'] as const)(
    'executes the repaired graph once after canvas refresh outcome: %s',
    async (outcome) => {
      const store = createStore()
      const workflow = createWorkflowStore({})
      const queryClient = createConsoleQueryClient()
      store.set(queryClientAtom, queryClient)
      const before = createSessionView({
        phase: 'test',
        run_status: 'waiting_confirmation',
      })
      const after = createSessionView({
        phase: 'modify',
        version: 2,
        run_status: 'waiting_input',
        app_revision: { current: 'repaired', conflicted: false },
      })
      store.set(difyBuilderSessionViewAtom, before)
      store.set(difyBuilderActiveSessionIdAtom, before.session_id)
      const pendingRefresh = createDeferred<WorkflowDraftRefreshResult>()
      const repairRefresh = vi
        .fn<() => Promise<WorkflowDraftRefreshResult>>()
        .mockReturnValueOnce(pendingRefresh.promise)
        .mockResolvedValue('refreshed')
      mocks.action.mockResolvedValueOnce(
        streamOf(
          commandStartedEvent(before),
          stateEvent(after, { post_canvas_action_id: 'run_test' }),
        ),
      )
      mocks.action.mockImplementationOnce(async () => {
        expect(mocks.graphApplied).toHaveBeenCalledOnce()
        return streamOf(
          commandStartedEvent(after),
          ...[runStarted(), nodeStarted(), nodeFinished(), runFinished()].map((payload, index) => ({
            event: 'workflow' as const,
            data: workflowEvent(payload, { at_version: 3, revision: index + 1 }),
          })),
          stateEvent({ ...after, version: 3, phase: 'review' }),
        )
      })
      render(
        <QueryClientProvider client={queryClient}>
          <Provider store={store}>
            <WorkflowContext value={workflow}>
              <ReactFlowProvider>
                <Harness repairRefresh={repairRefresh} />
              </ReactFlowProvider>
            </WorkflowContext>
          </Provider>
        </QueryClientProvider>,
      )
      const user = userEvent.setup()
      const approve = screen.getByRole('button', { name: 'Apply repair' })
      await waitFor(() => expect(approve).toBeEnabled())
      await user.click(approve)
      await waitFor(() => expect(store.get(difyBuilderSessionViewAtom)?.version).toBe(2))
      expect(mocks.action).toHaveBeenCalledOnce()
      expect(mocks.graphApplied).not.toHaveBeenCalled()

      await act(async () => pendingRefresh.resolve(outcome === 'manual retry' ? 'failed' : outcome))

      if (outcome === 'manual retry') {
        await waitFor(() => expect(store.get(difyBuilderCanvasRefreshFailedAtom)).toBe(true))
        expect(mocks.action).toHaveBeenCalledOnce()
        expect(mocks.graphApplied).not.toHaveBeenCalled()
        await user.dblClick(screen.getByRole('button', { name: 'Resync canvas' }))
      }

      if (outcome !== 'failed') {
        await waitFor(() =>
          expect(workflow.getState().workflowRunningData?.result.status).toBe('succeeded'),
        )
        expect(workflow.getState().workflowRunningData?.tracing?.[0]?.node_id).toBe('answer')
        expect(mocks.action).toHaveBeenCalledTimes(2)
        expect(mocks.action.mock.calls[1]?.[0].body).toMatchObject({
          action_id: 'run_test',
          base_version: 2,
          base_app_revision: 'repaired',
        })
        await user.dblClick(screen.getByRole('button', { name: 'Canvas refreshed' }))
        expect(mocks.action).toHaveBeenCalledTimes(2)
        expect(repairRefresh).toHaveBeenCalledTimes(outcome === 'refreshed' ? 1 : 2)
      } else {
        expect(mocks.action).toHaveBeenCalledOnce()
        expect(workflow.getState().workflowRunningData).toBeUndefined()
        expect(approve).toBeDisabled()
      }
    },
  )
})
