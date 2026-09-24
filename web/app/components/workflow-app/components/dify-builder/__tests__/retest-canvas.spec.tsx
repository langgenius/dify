import type { ReactNode } from 'react'
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
import { difyBuilderCanvasReadyAtom } from '../store'
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

const Harness = ({ repairRefresh }: { repairRefresh: Promise<boolean> }) => {
  const store = useStore()
  const canvas = useStoreApi()
  const events = useDifyBuilderRunEvents('app-1')
  const session = useDifyBuilderSessionController(undefined, events)
  const ready = useAtomValue(difyBuilderCanvasReadyAtom)
  const refresh = useCallback(
    async (shouldApply: () => boolean) => {
      const version = store.get(difyBuilderSessionViewAtom)!.version
      if (version === 2 && !(await repairRefresh)) return false
      if (!shouldApply()) return false
      const nodes: Node[] = (version === 1 ? ['start'] : ['start', 'answer']).map((id) => ({
        id,
        position: { x: 0, y: 0 },
        width: 200,
        height: 80,
        data: { title: id, type: BlockEnum.Code, desc: '' },
      }))
      canvas.getState().setNodes(nodes)
      if (version === 2) mocks.graphApplied()
      return true
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

  it.each([true, false])(
    'waits for the repaired graph refresh (success: %s) before executing its new node',
    async (refreshed) => {
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
      let finishRefresh!: (value: boolean) => void
      const repairRefresh = new Promise<boolean>((resolve) => {
        finishRefresh = resolve
      })
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

      await act(async () => finishRefresh(refreshed))

      if (refreshed) {
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
      } else {
        expect(mocks.action).toHaveBeenCalledOnce()
        expect(workflow.getState().workflowRunningData).toBeUndefined()
        expect(approve).toBeDisabled()
      }
    },
  )
})
