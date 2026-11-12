import type {
  ExternalTraceResponse,
  ExternalTraceStepResponse,
} from '@dify/contracts/api/console/external-agent-invocations/types.gen'
import { ORPCError } from '@orpc/client'
import { page } from 'vite-plus/test/browser'
import { toast } from '@/app/notifications'
import { createDeferred } from '@/test/deferred'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { renderTestPanel, testOverview, testResult } from './test-run-fixture'

// boundary: actual translations are supplied by this rendered feature fixture.
vi.mock('react-i18next', async (importOriginal) => importOriginal())
const api = vi.hoisted(() => ({ trace: vi.fn(), raw: vi.fn(), start: vi.fn(), leave: vi.fn() }))
// boundary: only generated remote Console operations are replaced, preserving real query keys, pagination and Collapsible controls.
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses, withConsoleResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'externalAgentTests.leavePage.post': api.leave,
    }),
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'externalAgents.capabilities.get': async () =>
        (await import('@/test/console/external-agents')).createExternalAgentCapabilities(),
      'externalAgents.byAgentId.tests.post': api.start,
      'externalAgentInvocations.byInvocationId.trace.get': api.trace,
      'externalAgentInvocations.byInvocationId.trace.steps.byStepKey.get': api.raw,
    }),
  }
})
function step(key: string, name: string, parent: string | null = null): ExternalTraceStepResponse {
  return {
    key,
    name,
    resolved_parent_key: parent,
    parent_step_id: null,
    kind: 'tool',
    trace_path: ['trace'],
    trace_id: 'trace',
    step_id: 'repeated-remote-id',
    started_at: null,
    ended_at: null,
    duration_seconds: null,
    status: null,
    error: null,
    total_tokens: null,
  }
}
function trace(
  steps: ExternalTraceStepResponse[],
  next: number | null = null,
  revision = 1,
): ExternalTraceResponse {
  return {
    invocation_id: testResult().invocation_id,
    state: 'received',
    revision,
    received_steps: 2,
    steps,
    next_offset: next,
    diagnostics: [],
  }
}
const panel = () => page.getByRole('dialog', { name: 'Test agent', exact: true })
async function openTrace() {
  await page.getByRole('button', { name: 'Test agent', exact: true }).click()
  await panel().getByRole('textbox', { name: 'Task', exact: true }).fill('Review the contract.')
  await panel().getByRole('button', { name: 'Run test', exact: true }).click()
  await expect
    .element(panel().getByRole('status').getByText('Success', { exact: true }))
    .toBeVisible()
  expect(api.trace).not.toHaveBeenCalled()
  await panel().getByRole('tab', { name: 'Tracing', exact: true }).click()
}
beforeEach(({ onTestFinished }) => {
  onTestFinished(guardUnexpectedFetch())
  onTestFinished(() => toast.dismiss())
  api.start.mockReset().mockResolvedValue(testResult('succeeded'))
  api.trace.mockReset()
  api.raw.mockReset().mockResolvedValue({
    data: { input: 'Raw input from the agent.', output: 'Raw output from the agent.' },
  })
  api.leave.mockReset().mockResolvedValue({ result: 'success' })
})

it('keeps a fixed trace revision across pages, uses opaque keys for duplicate remote IDs and loads Raw only on expansion', async () => {
  api.trace
    .mockResolvedValueOnce(trace([step('root-key', 'Root step')], 1))
    .mockResolvedValue(trace([step('child-key', 'Child step', 'root-key')]))
  const rendered = await renderTestPanel(testOverview(true))
  onTestFinished(() => rendered.queryClient.clear())
  await openTrace()
  const root = panel().getByRole('button', { name: /Root step/ })
  await expect.element(root).toBeVisible()
  expect(api.raw).not.toHaveBeenCalled()
  await panel().getByRole('button', { name: 'Load More', exact: true }).click()
  await expect.element(panel().getByRole('button', { name: /Child step/ })).toBeVisible()
  expect(api.trace.mock.calls[1]![0].query).toMatchObject({ offset: 1, revision: 1 })
  await root.click()
  await expect.element(panel().getByText(/Raw input from the agent\./)).toBeVisible()
  expect(api.raw.mock.calls[0]![0].params.step_key).toBe('root-key')
  expect(api.trace).toHaveBeenCalledTimes(2)
})

it('discards old trace pages and reloads from offset zero after a snapshot conflict', async () => {
  api.trace
    .mockResolvedValueOnce(trace([step('old-key', 'Old snapshot')], 1, 1))
    .mockRejectedValueOnce(
      new ORPCError('CONFLICT', { status: 409, message: 'Trace snapshot changed.' }),
    )
    .mockResolvedValue(trace([step('new-key', 'Current snapshot')], null, 2))
  const rendered = await renderTestPanel(testOverview(true))
  onTestFinished(() => rendered.queryClient.clear())
  await openTrace()
  await expect.element(panel().getByRole('button', { name: /Old snapshot/ })).toBeVisible()
  await panel().getByRole('button', { name: 'Load More', exact: true }).click()
  await expect.element(panel().getByRole('button', { name: /Current snapshot/ })).toBeVisible()
  await expect
    .element(panel().getByRole('button', { name: /Old snapshot/ }))
    .not.toBeInTheDocument()
  expect(api.trace.mock.calls[2]![0].query).toMatchObject({ offset: 0 })
  expect(api.trace.mock.calls[2]![0].query.revision).toBeUndefined()
})

it('keeps trace loading visible and hides a failed query without showing Retry or an empty-trace result', async () => {
  const pending = createDeferred<ExternalTraceResponse>()
  api.trace.mockReturnValue(pending.promise)
  const rendered = await renderTestPanel(testOverview(true))
  onTestFinished(() => rendered.queryClient.clear())
  await openTrace()
  await expect
    .element(panel().getByText('Waiting for the agent response', { exact: true }))
    .toBeVisible()
  pending.reject(
    new ORPCError('INTERNAL_SERVER_ERROR', { status: 500, message: 'Trace query failed.' }),
  )
  await expect
    .element(panel().getByText('Waiting for the agent response', { exact: true }))
    .not.toBeInTheDocument()
  await expect.element(panel().getByRole('alert')).not.toBeInTheDocument()
  await expect
    .element(panel().getByRole('button', { name: 'Retry', exact: true }))
    .not.toBeInTheDocument()
  await expect
    .element(panel().getByText('No trace received yet', { exact: true }))
    .not.toBeInTheDocument()
  await expect
    .element(panel().getByText('The agent returned an empty trace.', { exact: true }))
    .not.toBeInTheDocument()
})

it('keeps Raw loading visible and removes the extra failed-query message and Retry action', async () => {
  const pending = createDeferred<{ data: unknown }>()
  api.trace.mockResolvedValue(trace([step('root-key', 'Root step')]))
  api.raw.mockReturnValue(pending.promise)
  const rendered = await renderTestPanel(testOverview(true))
  onTestFinished(() => rendered.queryClient.clear())
  await openTrace()
  await panel()
    .getByRole('button', { name: /Root step/ })
    .click()
  await expect
    .element(panel().getByText('Waiting for the agent response', { exact: true }))
    .toBeVisible()
  pending.reject(
    new ORPCError('INTERNAL_SERVER_ERROR', { status: 500, message: 'Raw query failed.' }),
  )
  await expect.element(panel().getByText('Raw data', { exact: true })).not.toBeInTheDocument()
  await expect
    .element(panel().getByText('Raw query failed.', { exact: true }))
    .not.toBeInTheDocument()
  await expect.element(panel().getByRole('alert')).not.toBeInTheDocument()
  await expect
    .element(panel().getByRole('button', { name: 'Retry', exact: true }))
    .not.toBeInTheDocument()
  await expect.element(panel().getByRole('button', { name: /Root step/ })).toBeVisible()
})
