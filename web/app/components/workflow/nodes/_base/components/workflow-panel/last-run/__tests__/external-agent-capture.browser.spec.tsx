import type {
  ExternalTraceCaptureResponse,
  WorkflowRunNodeExecutionResponse,
} from '@dify/contracts/api/console/apps/types.gen'
import { render } from 'vitest-browser-react'
import {
  createStoresFromOptions,
  createWorkflowWrapper,
} from '@/app/components/workflow/__tests__/workflow-test-providers'
import { TEST_APP_ID } from '@/test/console/ids'
import { installFakeApi } from '@/test/fake-api'
import LastRun from '../index'

// boundary: Monaco's external runtime is unrelated to routing saved execution evidence to the status row.
vi.mock('@monaco-editor/react', () => ({
  default: () => null,
  loader: { config: vi.fn() },
}))

const appIds = {
  first: TEST_APP_ID,
  second: '019a0000-0000-7000-8000-000000000002',
  native: '019a0000-0000-7000-8000-000000000003',
} as const
const nativeExecutionId = '00000000-0000-4000-8000-000000000004'
const invocations = {
  [appIds.first]: '94118674-4807-451a-ac2e-add5f341dc5c',
  [appIds.second]: 'a21be92d-9a0e-547a-9d6b-4659cc3fc460',
} as const

it.each(['object', 'serialized'] as const)(
  'routes %s External Agent process data through the current App and keeps Native Agent tracing separate',
  async (encoding) => {
    const capturePaths: string[] = []
    const fake = installFakeApi({
      console: {
        apps: {
          byAppId: {
            workflows: {
              draft: {
                nodes: {
                  byNodeId: {
                    lastRun: {
                      get: ({ params }) => {
                        const appId = params.app_id === appIds.second ? appIds.second : appIds.first
                        const native = params.app_id === appIds.native
                        const process = { external_invocation_id: invocations[appId] }
                        const execution: WorkflowRunNodeExecutionResponse = {
                          id: native ? nativeExecutionId : `${appId}-execution`,
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
                        return execution
                      },
                    },
                  },
                },
              },
            },
            externalAgentInvocations: {
              byInvocationId: {
                traceCapture: {
                  get: ({ params }) => {
                    capturePaths.push(
                      `/console/api/apps/${params.app_id}/external-agent-invocations/${params.invocation_id}/trace-capture`,
                    )
                    const capture: ExternalTraceCaptureResponse = {
                      invocation_id: params.invocation_id,
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
                    return capture
                  },
                },
              },
            },
            traceRuns: {
              bySourceKind: {
                bySourceId: {
                  get: () => ({
                    source_kind: 'node',
                    source_id: nativeExecutionId,
                    status: 'accepted',
                    provider: 'langfuse',
                    span_url: 'https://trace.example/native-only',
                  }),
                },
              },
            },
          },
        },
      },
    })
    onTestFinished(fake)

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
    const screen = await render(view(appIds.first))
    await expect
      .element(screen.getByText('app.tracing.captureRun.reason.source_app_disabled'))
      .toBeVisible()
    expect(capturePaths).toEqual([
      `/console/api/apps/${appIds.first}/external-agent-invocations/${invocations[appIds.first]}/trace-capture`,
    ])

    await screen.rerender(view(appIds.second))
    await expect
      .element(screen.getByText('app.tracing.captureRun.reason.source_app_disabled'))
      .toBeVisible()
    expect(capturePaths).toEqual([
      `/console/api/apps/${appIds.first}/external-agent-invocations/${invocations[appIds.first]}/trace-capture`,
      `/console/api/apps/${appIds.second}/external-agent-invocations/${invocations[appIds.second]}/trace-capture`,
    ])

    await screen.rerender(view(appIds.native))
    await expect
      .element(screen.getByRole('link', { name: 'app.tracing.run.viewSpan' }))
      .toHaveAttribute('href', 'https://trace.example/native-only')
    await expect.element(screen.getByText('app.tracing.captureRun.title')).not.toBeInTheDocument()
    expect(capturePaths).toHaveLength(2)
    expect(
      fake.console.apps.byAppId.traceRuns.bySourceKind.bySourceId.get,
    ).toHaveBeenCalledExactlyOnceWith({
      params: { app_id: appIds.native, source_kind: 'node', source_id: nativeExecutionId },
      query: {},
    })
  },
)
