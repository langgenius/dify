import type {
  AppTraceResponse,
  ExternalTraceCaptureResponse,
  ExternalTraceTargetCaptureResponse,
} from '@dify/contracts/api/console/apps/types.gen'
import type { ConsoleClient } from '@/service/console'
import { render } from 'vitest-browser-react'
import { TracingConfiguration } from '@/app/components/app/tracing/configuration'
import { TEST_APP_ID } from '@/test/console/ids'
import { createQueryClientWrapper } from '@/test/console/query-client'
import { createSystemFeaturesFixture } from '@/test/console/system-features'
import { apiError, installFakeApi } from '@/test/fake-api'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import { createTestQueryClient } from '@/test/query-client'
import { ExternalAgentCaptureRow } from '../external-agent-capture-row'

const invocationId = '94118674-4807-451a-ac2e-add5f341dc5c'
const source = { appId: TEST_APP_ID, invocationId }
const otherAppId = '019a0000-0000-7000-8000-000000000002'
const target = (
  overrides: Partial<ExternalTraceTargetCaptureResponse> = {},
): ExternalTraceTargetCaptureResponse => ({
  target_kind: 'asset',
  target_id: 'agent-1',
  provider: 'langfuse',
  config_revision: '1',
  capture_content: false,
  capture_policy: { version: 1, source_app_capture_content: false, target_capture_content: true },
  status: 'metadata_only',
  reasons: ['source_app_disabled'],
  delivery_state: 'accepted',
  payload_revision: 1,
  ...overrides,
})
const result = (targets = [target()]): ExternalTraceCaptureResponse => ({
  invocation_id: invocationId,
  targets_frozen: true,
  targets,
})

type CaptureInput = Parameters<
  ConsoleClient['apps']['byAppId']['externalAgentInvocations']['byInvocationId']['traceCapture']['get']
>[0]

function captureServer(get: (input: CaptureInput) => ExternalTraceCaptureResponse) {
  const fake = installFakeApi({
    console: {
      apps: {
        byAppId: {
          externalAgentInvocations: { byInvocationId: { traceCapture: { get } } },
        },
      },
    },
  })
  onTestFinished(fake)
  return fake.console.apps.byAppId.externalAgentInvocations.byInvocationId.traceCapture.get
}

async function setup(appId = source.appId, showConfiguration = false) {
  const QueryProvider = createQueryClientWrapper(createTestQueryClient())
  const { wrapper: NuqsProvider } = createNuqsTestWrapper({ hasMemory: true })
  const view = (id: string) => (
    <QueryProvider>
      <NuqsProvider>
        {showConfiguration && (
          <TracingConfiguration
            resource={{ kind: 'app', appId: id, mode: 'workflow' }}
            readOnly={false}
          />
        )}
        <dl>
          <ExternalAgentCaptureRow key={id} source={{ appId: id, invocationId }} />
        </dl>
      </NuqsProvider>
    </QueryProvider>
  )
  const screen = await render(view(appId))
  return { screen, view }
}

it('keeps the old invocation’s frozen restriction when App consent changes and separates content from delivery', async () => {
  let policy: AppTraceResponse = {
    enabled: false,
    tracing_provider: null,
    capture_content: false,
    capture_agent: true,
  }
  const writes: unknown[] = []
  const fake = installFakeApi({
    console: {
      systemFeatures: { get: () => createSystemFeaturesFixture() },
      apps: {
        byAppId: {
          externalAgentInvocations: { byInvocationId: { traceCapture: { get: () => result() } } },
          traceConfig: { get: () => ({ has_not_configured: true }) },
          trace: {
            get: () => policy,
            post: ({ body }) => {
              policy = body
              writes.push(policy)
              return { result: 'success' }
            },
          },
        },
      },
    },
  })
  onTestFinished(fake)
  const { screen } = await setup(source.appId, true)
  await expect.element(screen.getByText('app.tracing.captureRun.metadata_only')).toBeVisible()
  await expect
    .element(screen.getByText('app.tracing.captureRun.reason.source_app_disabled'))
    .toBeVisible()
  await expect
    .element(screen.getByText(/app\.tracing\.captureRun\.delivery.*app\.tracing\.run\.accepted/))
    .toBeVisible()
  await screen.getByRole('button', { name: 'app.tracing.title', exact: true }).click()
  await screen.getByRole('switch', { name: 'app.tracing.appContentAuthorization' }).click()
  await expect
    .poll(() => writes)
    .toEqual([
      { enabled: false, tracing_provider: null, capture_content: true, capture_agent: true },
    ])
  await expect
    .element(screen.getByRole('switch', { name: 'app.tracing.appContentAuthorization' }))
    .toBeChecked()
  await expect
    .element(screen.getByText('app.tracing.captureRun.reason.source_app_disabled'))
    .toBeVisible()
  await expect.element(screen.getByText('app.tracing.captureRun.metadata_only')).toBeVisible()
})

it('uses the new App identity, hides inaccessible old data, and allows a visible retry', async () => {
  const paths: string[] = []
  let forbidden = true
  captureServer(({ params }) => {
    paths.push(
      `/console/api/apps/${params.app_id}/external-agent-invocations/${params.invocation_id}/trace-capture`,
    )
    if (params.app_id === otherAppId && forbidden)
      throw apiError({ status: 403, message: 'Forbidden', code: 'forbidden' })
    return result(
      params.app_id === otherAppId
        ? [
            target({
              status: 'unknown',
              capture_policy: null,
              reasons: ['legacy_snapshot_unavailable'],
            }),
          ]
        : [
            target({
              status: 'content_included',
              reasons: [],
              capture_content: true,
              capture_policy: {
                version: 1,
                source_app_capture_content: true,
                target_capture_content: true,
              },
            }),
          ],
    )
  })
  const { screen, view } = await setup()
  await expect.element(screen.getByText('app.tracing.captureRun.content_included')).toBeVisible()
  await screen.rerender(view(otherAppId))
  await expect
    .element(screen.getByRole('alert'))
    .toHaveTextContent('app.tracing.captureRun.loadFailed')
  await expect
    .element(screen.getByText('app.tracing.captureRun.content_included'))
    .not.toBeInTheDocument()
  expect(paths).toEqual([
    `/console/api/apps/${source.appId}/external-agent-invocations/${invocationId}/trace-capture`,
    `/console/api/apps/${otherAppId}/external-agent-invocations/${invocationId}/trace-capture`,
  ])
  forbidden = false
  await screen.getByRole('button', { name: 'app.tracing.captureRun.refresh' }).click()
  await expect.element(screen.getByText('app.tracing.captureRun.unknown')).toBeVisible()
  await expect
    .element(screen.getByText('app.tracing.captureRun.reason.legacy_snapshot_unavailable'))
    .toBeVisible()
  await expect.element(screen.getByRole('alert')).not.toBeInTheDocument()
})

it('bounds automatic pending reads and lets the user refresh to a frozen empty destination set', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  try {
    let complete = false
    const reads = captureServer(() =>
      complete
        ? result([])
        : ({
            invocation_id: invocationId,
            targets_frozen: false,
            targets: [],
          } satisfies ExternalTraceCaptureResponse),
    )
    const { screen } = await setup()
    await expect.element(screen.getByText('app.tracing.captureRun.pending')).toBeVisible()
    await expect.poll(() => reads.mock.calls.length).toBe(1)
    for (let read = 2; read <= 20; read++) {
      await vi.advanceTimersByTimeAsync(5000)
      await expect.poll(() => reads.mock.calls.length).toBe(read)
    }
    await vi.advanceTimersByTimeAsync(60_000)
    expect(reads).toHaveBeenCalledTimes(20)
    await expect.element(screen.getByText('app.tracing.captureRun.pending')).toBeVisible()
    complete = true
    await screen.getByRole('button', { name: 'app.tracing.captureRun.refresh' }).click()
    await expect.element(screen.getByText('app.tracing.captureRun.notConfigured')).toBeVisible()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(reads).toHaveBeenCalledTimes(21)
  } finally {
    vi.useRealTimers()
  }
})

it('explains destination authorization and payload restrictions separately', async () => {
  const allowed = {
    version: 1 as const,
    source_app_capture_content: true,
    target_capture_content: true,
  }
  captureServer(() =>
    result([
      target({
        reasons: ['target_content_disabled'],
        capture_policy: {
          version: 1,
          source_app_capture_content: true,
          target_capture_content: false,
        },
      }),
      target({
        target_id: 'agent-2',
        capture_content: true,
        capture_policy: allowed,
        reasons: ['redaction_unavailable'],
      }),
      target({
        target_id: 'agent-3',
        capture_content: true,
        capture_policy: allowed,
        reasons: ['payload_budget_exceeded'],
      }),
      target({
        target_id: 'agent-4',
        capture_content: true,
        capture_policy: allowed,
        reasons: ['content_not_available'],
      }),
      target({
        target_kind: 'app',
        target_id: source.appId,
        capture_content: true,
        capture_policy: allowed,
        status: 'content_included',
        reasons: [],
        delivery_state: 'exporting',
      }),
    ]),
  )
  const { screen } = await setup()
  await expect
    .element(screen.getByText('app.tracing.captureRun.reason.target_content_disabled'))
    .toBeVisible()
  await expect
    .element(screen.getByText('app.tracing.captureRun.reason.redaction_unavailable'))
    .toBeVisible()
  await expect
    .element(screen.getByText('app.tracing.captureRun.reason.payload_budget_exceeded'))
    .toBeVisible()
  await expect
    .element(screen.getByText('app.tracing.captureRun.reason.content_not_available'))
    .toBeVisible()
  await expect.element(screen.getByText('app.tracing.captureRun.content_included')).toBeVisible()
  await expect
    .element(screen.getByText(/app\.tracing\.captureRun\.delivery.*app\.tracing\.run\.pending/))
    .toBeVisible()
})
