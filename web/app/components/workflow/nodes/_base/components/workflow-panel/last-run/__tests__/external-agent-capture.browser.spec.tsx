import type {
  ExternalTraceCaptureResponse,
  WorkflowRunNodeExecutionResponse,
} from '@dify/contracts/api/console/apps/types.gen'
import { render } from 'vitest-browser-react'
import {
  createStoresFromOptions,
  createWorkflowWrapper,
} from '@/app/components/workflow/__tests__/workflow-test-providers'
import LastRun from '../index'

const { request } = vi.hoisted(() => ({
  request:
    vi.fn<(url: string, init: RequestInit, options: { request: Request }) => Promise<Response>>(),
}))
// boundary: generated API transport; Last Run, its result panel, and capture-status queries stay real.
vi.mock('@/service/base', () => ({ request }))
// boundary: Monaco's external runtime is unrelated to routing saved execution evidence to the status row.
vi.mock('@monaco-editor/react', () => ({
  default: () => null,
  loader: { config: vi.fn() },
}))

const invocations = {
  'app-1': '94118674-4807-451a-ac2e-add5f341dc5c',
  'app-2': 'a21be92d-9a0e-547a-9d6b-4659cc3fc460',
} as const

it.each(['object', 'serialized'] as const)(
  'routes %s External Agent process data through the current App and keeps Native Agent tracing separate',
  async (encoding) => {
    const capturePaths: string[] = []
    request.mockImplementation(async (_url, _init, { request: sent }) => {
      const path = new URL(sent.url).pathname
      const appId = path.includes('/apps/app-2/') ? 'app-2' : 'app-1'
      const native = path.includes('/apps/native-app/')
      const invocationId = invocations[appId]
      if (path.endsWith('/last-run')) {
        const process = { external_invocation_id: invocationId }
        const execution: WorkflowRunNodeExecutionResponse = {
          id: native ? 'native-execution' : `${appId}-execution`,
          node_id: 'node-1',
          node_type: native ? 'agent' : 'external-agent',
          status: 'succeeded',
          process_data: native
            ? { workflow_agent_binding_id: 'native-binding' }
            : encoding === 'serialized'
              ? JSON.stringify(process)
              : process,
          extras: {},
        }
        return Response.json(execution)
      }
      if (path.endsWith('/trace-capture')) {
        capturePaths.push(path)
        const capture: ExternalTraceCaptureResponse = {
          invocation_id: invocationId,
          targets_frozen: true,
          targets: [
            {
              target_kind: 'asset',
              target_id: 'external-agent-1',
              provider: 'langfuse',
              config_revision: '1',
              capture_content: false,
              capture_policy: {
                version: 1,
                source_app_capture_content: false,
                target_capture_content: true,
              },
              status: 'metadata_only',
              reasons: ['source_app_disabled'],
              delivery_state: 'accepted',
              payload_revision: 1,
            },
          ],
        }
        return Response.json(capture)
      }
      if (path.endsWith('/trace-runs/node/native-execution'))
        return Response.json({
          source_kind: 'node',
          source_id: 'native-execution',
          status: 'accepted',
          provider: 'langfuse',
          span_url: 'https://trace.example/native-only',
        })
      throw new Error(`Unexpected request: ${path}`)
    })

    const view = (appId: string) => {
      const Wrapper = createWorkflowWrapper(createStoresFromOptions({}), undefined, undefined, {
        kind: 'app',
        appId,
        mode: 'workflow',
      })
      return (
        <Wrapper>
          <LastRun
            nodeId="node-1"
            canSingleRun
            isRunAfterSingleRun={false}
            updateNodeRunningStatus={vi.fn()}
            onSingleRunClicked={vi.fn()}
          />
        </Wrapper>
      )
    }
    const screen = await render(view('app-1'))
    await expect
      .element(screen.getByText('app.tracing.captureRun.reason.source_app_disabled'))
      .toBeVisible()
    expect(capturePaths).toEqual([
      `/console/api/apps/app-1/external-agent-invocations/${invocations['app-1']}/trace-capture`,
    ])

    await screen.rerender(view('app-2'))
    await expect
      .element(screen.getByText('app.tracing.captureRun.reason.source_app_disabled'))
      .toBeVisible()
    expect(capturePaths).toEqual([
      `/console/api/apps/app-1/external-agent-invocations/${invocations['app-1']}/trace-capture`,
      `/console/api/apps/app-2/external-agent-invocations/${invocations['app-2']}/trace-capture`,
    ])

    await screen.rerender(view('native-app'))
    await expect
      .element(screen.getByRole('link', { name: 'app.tracing.run.viewSpan' }))
      .toHaveAttribute('href', 'https://trace.example/native-only')
    await expect.element(screen.getByText('app.tracing.captureRun.title')).not.toBeInTheDocument()
    expect(capturePaths).toHaveLength(2)
  },
)
