import { ORPCError } from '@orpc/client'
import { act, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import {
  createEdge,
  createNode,
  createStartNode,
} from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowHook as renderHook } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum, InputVarType, VarType } from '@/app/components/workflow/types'
import { toast } from '@/app/notifications'
import { AppToaster } from '@/app/notifications/app-toaster'
import { consoleClient } from '@/service/console'
import useOneStepRun from '../use-one-step-run'

vi.mock('@/app/components/base/amplitude', () => ({
  trackEvent: vi.fn(),
}))

const { runTrigger } = vi.hoisted(() => ({
  runTrigger:
    vi.fn<typeof consoleClient.apps.byAppId.workflows.draft.nodes.byNodeId.trigger.run.post>(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'apps.byAppId.workflows.draft.nodes.byNodeId.trigger.run.post': runTrigger,
      'apps.byAppId.workflows.draft.nodes.byNodeId.variables.get': async () => ({ items: [] }),
    }),
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'spec.schemaDefinitions.get': async () => [],
      'apps.byAppId.workflows.draft.systemVariables.get': async () => ({ items: [] }),
      'apps.byAppId.workflows.draft.conversationVariables.get': async () => ({ items: [] }),
      'workspaces.current.tools.builtin.get': async () => [],
      'workspaces.current.tools.api.get': async () => [],
      'workspaces.current.tools.workflow.get': async () => [],
      'workspaces.current.tools.mcp.get': async () => [],
    }),
  }
})

const renderUseOneStepRun = (type: BlockEnum = BlockEnum.IfElse) => {
  render(createElement(AppToaster))
  const nodes = [
    createStartNode({ id: 'start', data: { variables: [] } }),
    createNode({ id: 'if-else-node', data: { type, title: 'Test node' } }),
  ]
  const edges = [createEdge({ source: 'start', target: 'if-else-node' })]
  return renderHook(
    () =>
      useOneStepRun({
        id: 'if-else-node',
        resource: { kind: 'app', appId: 'app-id', mode: 'workflow' },

        data: {
          type,
          title: 'IF/ELSE',
          desc: '',
        },
        defaultRunInputData: {},
        isRunAfterSingleRun: false,
        isPaused: false,
      }),
    {
      resource: { kind: 'app', appId: 'app-id', mode: 'workflow' },
      nodes,
      edges,
      historyStore: { nodes, edges },
    },
  )
}

const originalUrl = window.location.href

describe('useOneStepRun single-run input vars', () => {
  beforeEach(() => {
    runTrigger.mockReset()
    window.history.replaceState(null, '', '/app/app-id/workflow')
  })
  afterEach(async () => {
    window.history.replaceState(null, '', originalUrl)
    vi.restoreAllMocks()
    await act(async () => toast.dismiss())
  })

  it('uses value_type when the variable cannot be resolved from output vars', () => {
    const { result } = renderUseOneStepRun()

    const inputs = result.current.toVarInputs([
      {
        variable: '#start.amount#',
        value_selector: ['start', 'amount'],
        value_type: VarType.number,
      },
    ])

    expect(inputs).toMatchObject([
      {
        variable: '#start.amount#',
        type: InputVarType.number,
      },
    ])
  })

  it('resolves global system vars by full variable name', async () => {
    const { result } = renderUseOneStepRun()
    await waitFor(() =>
      expect(result.current.varSelectorsToVarInputs([['sys', 'timestamp']])).toMatchObject([
        { variable: '#sys.timestamp#', type: InputVarType.number },
      ]),
    )
  })

  it.each([BlockEnum.TriggerSchedule, BlockEnum.TriggerWebhook, BlockEnum.TriggerPlugin])(
    'runs %s with the app identity and supports aborting polling requests',
    async (type) => {
      const run = vi.mocked(
        consoleClient.apps.byAppId.workflows.draft.nodes.byNodeId.trigger.run.post,
      )
      run.mockResolvedValueOnce({ id: 'execution-1', status: 'succeeded' })
      const { result } = renderUseOneStepRun(type)
      await act(async () => {
        await result.current.handleRun({})
      })
      expect(run.mock.calls[0]?.[0]).toEqual({
        params: { app_id: 'app-id', node_id: 'if-else-node' },
      })
      if (type !== BlockEnum.TriggerSchedule)
        expect(run.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    },
  )

  it.each([BlockEnum.TriggerWebhook, BlockEnum.TriggerPlugin])(
    'aborts the pending %s request when listening stops',
    async (type) => {
      const run = vi.mocked(
        consoleClient.apps.byAppId.workflows.draft.nodes.byNodeId.trigger.run.post,
      )
      run.mockImplementationOnce(
        (_input, options) =>
          new Promise((_resolve, reject) => {
            options?.signal?.addEventListener(
              'abort',
              () => reject(new DOMException('Aborted', 'AbortError')),
              { once: true },
            )
          }),
      )
      const { result, store } = renderUseOneStepRun(type)
      await act(async () => {
        const pendingRun = result.current.handleRun({})
        result.current.handleStop()
        expect(await pendingRun).toBe(false)
      })
      expect(run.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
      expect(store.getState()).toMatchObject({
        isListening: false,
        listeningTriggerNodeId: null,
        listeningTriggerNodeIds: [],
      })
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    },
  )

  it('preserves the plugin request error and metadata when reporting a failed run', async () => {
    const error = new ORPCError('forbidden', {
      status: 403,
      message: 'Plugin access denied',
      data: { reason: 'PLUGIN_ACCESS_DENIED' },
      cause: { headers: new Headers({ 'X-Request-Id': 'plugin-run-1' }) },
    })
    vi.mocked(
      consoleClient.apps.byAppId.workflows.draft.nodes.byNodeId.trigger.run.post,
    ).mockRejectedValueOnce(error)
    const reportError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = renderUseOneStepRun(BlockEnum.TriggerPlugin)

    await act(async () => {
      expect(await result.current.handleRun({})).toBe(false)
    })

    expect(await screen.findByText('Plugin access denied')).toBeInTheDocument()
    expect(reportError).toHaveBeenCalledWith(error)
  })
})
