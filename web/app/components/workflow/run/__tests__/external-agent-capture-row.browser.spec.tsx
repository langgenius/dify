import type {
  ExternalTraceCaptureResponse,
  ExternalTraceTargetCaptureResponse,
} from '@dify/contracts/api/console/apps/types.gen'
import { render } from 'vitest-browser-react'
import { TracingConfiguration } from '@/app/components/app/tracing/configuration'
import { httpErrorFromResponse } from '@/service/http-error'
import { createQueryClientWrapper } from '@/test/console/query-client'
import { createSystemFeaturesFixture } from '@/test/console/system-features'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import { createTestQueryClient } from '@/test/query-client'
import { ExternalAgentCaptureRow } from '../external-agent-capture-row'

const { request } = vi.hoisted(() => ({
  request:
    vi.fn<(url: string, init: RequestInit, options: { request: Request }) => Promise<Response>>(),
}))
// boundary: generated API transport; frozen-state rendering and refresh behavior remain real.
vi.mock('@/service/base', () => ({ request }))

const invocationId = '94118674-4807-451a-ac2e-add5f341dc5c'
const source = { appId: 'app-1', invocationId }
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
  let policy = {
    enabled: false,
    tracing_provider: null,
    capture_content: false,
    capture_agent: true,
  }
  const writes: unknown[] = []
  request.mockImplementation(async (_url, _init, { request: sent }) => {
    const path = new URL(sent.url).pathname
    if (path.endsWith('/trace-capture')) return Response.json(result())
    if (path.endsWith('/system-features')) return Response.json(createSystemFeaturesFixture())
    if (path.endsWith('/trace-config')) return Response.json({ has_not_configured: true })
    if (path.endsWith('/trace')) {
      if (sent.method === 'POST') {
        policy = await sent.json()
        writes.push(policy)
        return Response.json({ result: 'success' })
      }
      return Response.json(policy)
    }
    throw new Error(`Unexpected request: ${path}`)
  })
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
  request.mockImplementation(async (_url, _init, { request: sent }) => {
    const path = new URL(sent.url).pathname
    paths.push(path)
    if (path.includes('/apps/app-2/') && forbidden)
      throw await httpErrorFromResponse(Response.json({ message: 'Forbidden' }, { status: 403 }))
    return Response.json(
      result(
        path.includes('/apps/app-2/')
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
      ),
    )
  })
  const { screen, view } = await setup()
  await expect.element(screen.getByText('app.tracing.captureRun.content_included')).toBeVisible()
  await screen.rerender(view('app-2'))
  await expect
    .element(screen.getByRole('alert'))
    .toHaveTextContent('app.tracing.captureRun.loadFailed')
  await expect
    .element(screen.getByText('app.tracing.captureRun.content_included'))
    .not.toBeInTheDocument()
  expect(paths).toEqual([
    `/console/api/apps/app-1/external-agent-invocations/${invocationId}/trace-capture`,
    `/console/api/apps/app-2/external-agent-invocations/${invocationId}/trace-capture`,
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
    request.mockImplementation(async () =>
      Response.json(
        complete
          ? result([])
          : ({
              invocation_id: invocationId,
              targets_frozen: false,
              targets: [],
            } satisfies ExternalTraceCaptureResponse),
      ),
    )
    const { screen } = await setup()
    await expect.element(screen.getByText('app.tracing.captureRun.pending')).toBeVisible()
    await expect.poll(() => request.mock.calls.length).toBe(1)
    for (let read = 2; read <= 20; read++) {
      await vi.advanceTimersByTimeAsync(5000)
      await expect.poll(() => request.mock.calls.length).toBe(read)
    }
    await vi.advanceTimersByTimeAsync(60_000)
    expect(request).toHaveBeenCalledTimes(20)
    await expect.element(screen.getByText('app.tracing.captureRun.pending')).toBeVisible()
    complete = true
    await screen.getByRole('button', { name: 'app.tracing.captureRun.refresh' }).click()
    await expect.element(screen.getByText('app.tracing.captureRun.notConfigured')).toBeVisible()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(request).toHaveBeenCalledTimes(21)
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
  request.mockImplementation(async () =>
    Response.json(
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
          target_id: 'app-1',
          capture_content: true,
          capture_policy: allowed,
          status: 'content_included',
          reasons: [],
          delivery_state: 'exporting',
        }),
      ]),
    ),
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
