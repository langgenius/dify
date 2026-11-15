import { ORPCError } from '@orpc/client'
import { page } from 'vite-plus/test/browser'
import { toast } from '@/app/notifications'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { anchorId, childId, renderTestPanel, testOverview, testResult } from './test-run-fixture'

// boundary: real translations name the user-facing controls in this browser fixture.
vi.mock('react-i18next', async (importOriginal) => importOriginal())
const api = vi.hoisted(() => ({ start: vi.fn(), read: vi.fn(), cancel: vi.fn(), leave: vi.fn() }))
// boundary: only generated Console transport responses are stubbed; the session, queries, mutations and Drawer stay real.
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
      'externalAgents.byAgentId.tests.byInvocationId.get': api.read,
      'externalAgents.byAgentId.tests.byInvocationId.cancel.post': api.cancel,
    }),
  }
})
const panel = () => page.getByRole('dialog', { name: 'Test agent', exact: true })
const task = () => panel().getByRole('textbox', { name: 'Task', exact: true })
const status = () => panel().getByRole('status')
async function openAndRun() {
  await page.getByRole('button', { name: 'Test agent', exact: true }).click()
  await task().fill('Review this contract.')
  await panel().getByRole('button', { name: 'Run test', exact: true }).click()
  await expect.element(status().getByText('Running', { exact: true })).toBeVisible()
}
function usePollClock() {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  })
  onTestFinished(() => {
    vi.useRealTimers()
  })
}
beforeEach(({ onTestFinished }) => {
  onTestFinished(guardUnexpectedFetch())
  onTestFinished(() => toast.dismiss())
  api.start.mockReset().mockResolvedValue(testResult())
  api.read.mockReset().mockResolvedValue(testResult())
  api.cancel.mockReset().mockResolvedValue({ result: 'requested' })
  api.leave.mockReset().mockResolvedValue({ result: 'success' })
})

it('polls the fixed anchor, cancels its latest retry child, and gives completion priority over pending cancellation', async () => {
  const rendered = await renderTestPanel()
  onTestFinished(() => rendered.queryClient.clear())
  api.read
    .mockResolvedValueOnce(testResult('retry_pending', { invocation_id: childId }))
    .mockResolvedValue(
      testResult('succeeded', {
        invocation_id: childId,
        metadata: {
          agent_id: testOverview().asset.id,
          anchor_invocation_id: anchorId,
          test_generation: 1,
          cancellation_state: 'requested',
        },
      }),
    )
  usePollClock()
  await openAndRun()
  expect(api.start).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1_500)
  await expect.poll(() => api.read.mock.calls.length).toBe(1)
  await panel().getByRole('button', { name: 'Stop test', exact: true }).click()
  await expect.element(status().getByText('Success', { exact: true })).toBeVisible()
  expect(api.cancel).toHaveBeenCalledWith({
    params: { agent_id: testOverview().asset.id, invocation_id: childId },
  })
  for (const [input] of api.read.mock.calls) expect(input.params.invocation_id).toBe(anchorId)
  await expect
    .element(panel().getByText('Result supplied by the agent.', { exact: true }))
    .toBeVisible()
  await expect.element(status().getByText('Not provided', { exact: true })).toBeVisible()
  await vi.advanceTimersByTimeAsync(10_000)
  expect(api.start).toHaveBeenCalledTimes(1)
  expect(api.read).toHaveBeenCalledTimes(2)
})

it('recovers an unknown submission with the identical key and body instead of creating a second logical test', async () => {
  const rendered = await renderTestPanel()
  onTestFinished(() => rendered.queryClient.clear())
  api.start
    .mockRejectedValueOnce(new TypeError('Connection lost.'))
    .mockResolvedValue(testResult('succeeded'))
  await page.getByRole('button', { name: 'Test agent', exact: true }).click()
  await task().fill('Review this contract.')
  await panel().getByRole('button', { name: 'Run test', exact: true }).click()
  const recover = panel().getByRole('button', { name: 'Recover request', exact: true })
  await expect.element(recover).toBeVisible()
  await expect.element(task()).toHaveAttribute('readonly')
  const original = api.start.mock.calls[0]![0]
  await recover.click()
  await expect.element(status().getByText('Success', { exact: true })).toBeVisible()
  expect(api.start).toHaveBeenCalledTimes(2)
  expect(api.start.mock.calls[1]![0]).toEqual(original)
  expect(original.body.idempotency_key).toBeTruthy()
  expect(api.read).not.toHaveBeenCalled()
})

it('keeps a closed test running, restores its input through the result toast, and leaves only when its page unmounts', async () => {
  const rendered = await renderTestPanel()
  onTestFinished(() => rendered.queryClient.clear())
  api.read.mockResolvedValue(testResult('succeeded'))
  usePollClock()
  await openAndRun()
  await panel().getByRole('button', { name: 'Close', exact: true }).click()
  await expect.element(panel()).not.toBeInTheDocument()
  await expect.element(page.getByRole('button', { name: 'Testing…', exact: true })).toBeVisible()
  expect(api.leave).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1_500)
  const notification = page.getByRole('dialog', { name: 'Agent test finished.', exact: true })
  await expect.element(notification).toBeVisible()
  await notification.getByRole('button', { name: 'View result', exact: true }).click()
  await expect.element(task()).toHaveValue('Review this contract.')
  await expect.element(status().getByText('Success', { exact: true })).toBeVisible()
  expect(api.leave).not.toHaveBeenCalled()
  const sessionId = api.start.mock.calls[0]![0].body.page_session_id
  await rendered.unmount()
  await expect.poll(() => api.leave.mock.calls.length).toBe(1)
  expect(api.leave.mock.calls[0]![0]).toEqual({ body: { page_session_id: sessionId } })
  expect(api.leave.mock.calls[0]![1]).toEqual({ context: { keepalive: true, silent: true } })
})

it('preserves input across a generation change and rejects a late result from the previous configuration', async () => {
  const overview = testOverview()
  const rendered = await renderTestPanel(overview)
  onTestFinished(() => rendered.queryClient.clear())
  let resolveRead: (result: ReturnType<typeof testResult>) => void = () => {}
  api.read.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveRead = resolve
      }),
  )
  usePollClock()
  await openAndRun()
  await vi.advanceTimersByTimeAsync(1_500)
  await expect.poll(() => api.read.mock.calls.length).toBe(1)
  await rendered.rerenderOverview({
    ...overview,
    asset: { ...overview.asset, test_display_generation: 2 },
  })
  await expect.element(task()).toHaveValue('Review this contract.')
  await expect.element(status()).not.toBeInTheDocument()
  resolveRead(testResult('succeeded'))
  await expect
    .element(panel().getByText('Result supplied by the agent.', { exact: true }))
    .not.toBeInTheDocument()
  await expect.element(panel().getByRole('button', { name: 'Run test', exact: true })).toBeEnabled()
  expect(api.start).toHaveBeenCalledTimes(1)
})

it('clears an expired result and its trace instead of keeping stale sensitive output visible', async () => {
  const rendered = await renderTestPanel()
  onTestFinished(() => rendered.queryClient.clear())
  api.read.mockRejectedValue(
    new ORPCError('GONE', { status: 410, message: 'The test result expired.' }),
  )
  usePollClock()
  await openAndRun()
  await vi.advanceTimersByTimeAsync(1_500)
  await expect.element(panel().getByRole('alert')).toHaveTextContent('The test result expired.')
  await expect.element(status()).not.toBeInTheDocument()
  await expect.element(task()).toHaveValue('Review this contract.')
  await vi.advanceTimersByTimeAsync(5_000)
  expect(api.read).toHaveBeenCalledTimes(1)
  expect(api.start).toHaveBeenCalledTimes(1)
})

it('does not add a query error or Retry block when reading a running test fails', async () => {
  const rendered = await renderTestPanel()
  onTestFinished(() => rendered.queryClient.clear())
  api.read.mockRejectedValue(
    new ORPCError('INTERNAL_SERVER_ERROR', { status: 500, message: 'Result query failed.' }),
  )
  usePollClock()
  await openAndRun()
  await vi.advanceTimersByTimeAsync(1_500)
  await expect.poll(() => api.read.mock.calls.length).toBe(1)
  await expect.element(panel().getByRole('alert')).not.toBeInTheDocument()
  await expect
    .element(panel().getByRole('button', { name: 'Retry', exact: true }))
    .not.toBeInTheDocument()
  await expect
    .element(panel().getByText('Result query failed.', { exact: true }))
    .not.toBeInTheDocument()
  await expect.element(status().getByText('Running', { exact: true })).toBeVisible()
})
