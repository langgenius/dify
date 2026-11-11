import type { EventEmitterValue } from '@/context/event-emitter'
import type { WorkflowRunDetailResponse } from '@/models/log'
import { act, screen, waitFor } from '@testing-library/react'
import { EventEmitter } from 'ahooks/lib/useEventEmitter'
import { useReactFlow } from 'reactflow'
import { EventEmitterContext } from '@/context/event-emitter'
import { createEdge, createNode } from '../../__tests__/fixtures'
import { renderWorkflowFlowComponent } from '../../__tests__/workflow-test-env'
import Record from '../record'

const WorkflowEventProvider = EventEmitterContext.Provider
let latestGetResultCallback: ((res: WorkflowRunDetailResponse) => void) | undefined

vi.mock('@/app/components/workflow/run', () => ({
  default: ({
    appId,
    runDetailUrl,
    tracingListUrl,
    getResultCallback,
  }: {
    appId?: string
    runDetailUrl: string
    tracingListUrl: string
    getResultCallback: (res: WorkflowRunDetailResponse) => void
  }) => {
    latestGetResultCallback = getResultCallback
    return (
      <div
        data-app-id={appId}
        data-run-detail-url={runDetailUrl}
        data-testid="run"
        data-tracing-list-url={tracingListUrl}
      />
    )
  },
}))

const createRunDetail = (
  overrides: Partial<WorkflowRunDetailResponse> = {},
): WorkflowRunDetailResponse => ({
  id: 'run-1',
  version: '1',
  graph: {
    nodes: [],
    edges: [],
  },
  inputs: '{}',
  inputs_truncated: false,
  status: 'succeeded',
  outputs: '{}',
  outputs_truncated: false,
  total_steps: 1,
  created_by_role: 'account',
  created_at: 1,
  finished_at: 2,
  ...overrides,
})

describe('Record', () => {
  beforeEach(() => {
    latestGetResultCallback = undefined
  })

  it('renders the run title and passes run and trace URLs to the run panel', () => {
    const getWorkflowRunAndTraceUrl = vi.fn((runId?: string) => ({
      runUrl: `/runs/${runId}`,
      traceUrl: `/traces/${runId}`,
    }))

    renderWorkflowFlowComponent(<Record />, {
      resource: { kind: 'app', appId: 'history-app', mode: 'workflow' },
      initialStoreState: {
        historyWorkflowData: {
          id: 'run-1',
          status: 'succeeded',
          finished_at: 1_700_000_000,
        },
      },
      hooksStoreProps: {
        getWorkflowRunAndTraceUrl,
      },
    })

    expect(screen.getByText(/^Test Run/)).toBeInTheDocument()
    expect(screen.getByTestId('run')).toHaveAttribute('data-app-id', 'history-app')
    expect(screen.getByTestId('run')).toHaveAttribute('data-run-detail-url', '/runs/run-1')
    expect(screen.getByTestId('run')).toHaveAttribute('data-tracing-list-url', '/traces/run-1')
  })

  it('renders paused history without a finished timestamp', () => {
    renderWorkflowFlowComponent(<Record />, {
      initialStoreState: {
        historyWorkflowData: {
          id: 'run-1',
          status: 'paused',
        },
      },
    })

    expect(screen.getByText('Test Run (Paused)')).toBeInTheDocument()
  })

  it.each([
    {
      name: 'the default viewport when omitted',
      viewport: undefined,
      expected: { x: 0, y: 0, zoom: 1 },
    },
    {
      name: 'the recorded viewport when supplied',
      viewport: { x: 12, y: 24, zoom: 0.75 },
      expected: { x: 12, y: 24, zoom: 0.75 },
    },
  ])('publishes the initialized run graph and restores $name', async ({ viewport, expected }) => {
    const nodes = [createNode({ id: 'source' }), createNode({ id: 'target' })]
    const edges = [createEdge({ id: 'edge', source: 'source', target: 'target' })]
    const events: EventEmitterValue[] = []
    const eventEmitter = new EventEmitter<EventEmitterValue>()
    let flow: ReturnType<typeof useReactFlow>
    function RunRecord() {
      flow = useReactFlow()
      eventEmitter.useSubscription((event) => events.push(event))
      return <Record />
    }
    renderWorkflowFlowComponent(
      <WorkflowEventProvider value={{ eventEmitter }}>
        <RunRecord />
      </WorkflowEventProvider>,
      {
        initialStoreState: { historyWorkflowData: { id: 'run-1', status: 'succeeded' } },
        reactFlowProps: { fitView: false, defaultViewport: { x: 40, y: 50, zoom: 0.5 } },
        hooksStoreProps: {
          getWorkflowRunAndTraceUrl: () => ({ runUrl: '/runs/run-1', traceUrl: '/traces/run-1' }),
        },
      },
    )
    act(() => latestGetResultCallback?.(createRunDetail({ graph: { nodes, edges, viewport } })))
    expect(events).toEqual([
      expect.objectContaining({
        type: 'WORKFLOW_DATA_UPDATE',
        payload: {
          nodes: [
            expect.objectContaining({
              id: 'source',
              data: expect.objectContaining({ _connectedSourceHandleIds: ['source'] }),
            }),
            expect.objectContaining({
              id: 'target',
              data: expect.objectContaining({ _connectedTargetHandleIds: ['target'] }),
            }),
          ],
          edges: [expect.objectContaining({ id: 'edge', source: 'source', target: 'target' })],
        },
      }),
    ])
    await waitFor(() => expect(flow!.getViewport()).toEqual(expected))
  })
})
