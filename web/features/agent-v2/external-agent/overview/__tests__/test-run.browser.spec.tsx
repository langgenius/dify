import { ORPCError } from '@orpc/client'
import { page, userEvent } from 'vite-plus/test/browser'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
import { createExternalAgentCapabilities } from '@/test/console/external-agents'
import { act } from '@/test/react-act'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { anchorId, childId, renderTestPanel, testOverview, testResult } from './test-run-fixture'

// boundary: real translations name the user-facing controls in this browser fixture.
vi.mock('react-i18next', async (importOriginal) => importOriginal())
const api = vi.hoisted(() => ({
  start: vi.fn(),
  read: vi.fn(),
  cancel: vi.fn(),
  leave: vi.fn(),
  capabilities: vi.fn(),
}))
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
      'externalAgents.capabilities.get': api.capabilities,
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
    // Control polling without also delaying Query's observer notifications.
    toFake: ['setInterval', 'clearInterval', 'Date'],
  })
  onTestFinished(() => {
    vi.useRealTimers()
  })
}
beforeEach(({ onTestFinished }) => {
  onTestFinished(guardUnexpectedFetch())
  onTestFinished(() => toast.dismiss())
  api.capabilities.mockReset().mockResolvedValue(createExternalAgentCapabilities())
  api.start.mockReset().mockResolvedValue(testResult())
  api.read.mockReset().mockResolvedValue(testResult())
  api.cancel.mockReset().mockResolvedValue({ result: 'requested' })
  api.leave.mockReset().mockResolvedValue({ result: 'success' })
})

it.each([
  {
    label: 'unknown',
    tokens: null,
    elapsed: null,
    reported: 1,
    total: 2,
    expected: 'Not reported',
    expectedTime: 'Not provided',
  },
  {
    label: 'zero',
    tokens: 0,
    elapsed: 0,
    reported: 1,
    total: 1,
    expected: '0',
    expectedTime: '0.0 s',
  },
  {
    label: 'positive',
    tokens: 12345,
    elapsed: 14.2,
    reported: 2,
    total: 2,
    expected: '12,345',
    expectedTime: '14.2 s',
  },
])(
  'shows $label token usage and its reported attempt coverage',
  async ({ tokens, elapsed, reported, total, expected, expectedTime }) => {
    api.start.mockResolvedValue(
      testResult('succeeded', {
        statistics: {
          ...testResult().statistics,
          total_tokens: tokens,
          elapsed_time: elapsed,
          attempt_count: total,
          token_reporting_numerator: reported,
          token_reporting_denominator: total,
        },
      }),
    )
    const rendered = await renderTestPanel()
    onTestFinished(() => rendered.queryClient.clear())
    await page.getByRole('button', { name: 'Test agent', exact: true }).click()
    await task().fill('Review this contract.')
    await panel().getByRole('button', { name: 'Run test', exact: true }).click()
    await expect.element(status().getByText('Success', { exact: true })).toBeVisible()
    await expect.element(status().getByText(expectedTime, { exact: true })).toBeVisible()
    await expect
      .element(
        status().getByText(new RegExp(`^${expected}\\s*${reported}/${total} attempts reported$`)),
      )
      .toBeVisible()
  },
)

it('shows missing token usage as unreported without replacing it with zero', async () => {
  // The wire response can omit this field on older deployments, despite the generated contract.
  api.start.mockResolvedValue({
    ...testResult('succeeded'),
    statistics: {
      attempt_count: 1,
      elapsed_time: null,
      token_reporting_numerator: 0,
      token_reporting_denominator: 1,
    },
  })
  const rendered = await renderTestPanel()
  onTestFinished(() => rendered.queryClient.clear())
  await page.getByRole('button', { name: 'Test agent', exact: true }).click()
  await task().fill('Review this contract.')
  await panel().getByRole('button', { name: 'Run test', exact: true }).click()
  await expect.element(status().getByText('Success', { exact: true })).toBeVisible()
  await expect.element(status().getByText(/^Not reported\s*0\/1 attempts reported$/)).toBeVisible()
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
        statistics: {
          elapsed_time: 37.8,
          total_tokens: 0,
          attempt_count: 2,
          token_reporting_numerator: 2,
          token_reporting_denominator: 2,
        },
      }),
    )
  usePollClock()
  await openAndRun()
  expect(api.start).toHaveBeenCalledTimes(1)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_500)
  })
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
  await expect.element(status().getByText(/^0\s*2\/2 attempts reported$/)).toBeVisible()
  await expect.element(status().getByText('37.8 s', { exact: true })).toBeVisible()
  await vi.advanceTimersByTimeAsync(10_000)
  expect(api.start).toHaveBeenCalledTimes(1)
  expect(api.read).toHaveBeenCalledTimes(2)
})

it('shows a submission gateway error once in Result and recovers the identical request even if execution is later disabled', async () => {
  const rendered = await renderTestPanel(testOverview(true))
  onTestFinished(() => rendered.queryClient.clear())
  api.start
    .mockRejectedValueOnce(new ORPCError('BAD_GATEWAY', { status: 502, message: 'Bad Gateway' }))
    .mockResolvedValue(testResult('succeeded'))
  await page.getByRole('button', { name: 'Test agent', exact: true }).click()
  await task().fill('Review this contract.')
  await panel().getByRole('button', { name: 'Run test', exact: true }).click()
  await expect.element(status().getByText('Error', { exact: true })).toBeVisible()
  await expect
    .element(
      panel()
        .getByRole('tabpanel', { name: 'Result', exact: true })
        .getByText('Bad Gateway', { exact: true }),
    )
    .toBeVisible()
  expect(panel().getByText('Bad Gateway', { exact: true }).all()).toHaveLength(1)
  await expect.element(panel().getByRole('alert')).not.toBeInTheDocument()
  await expect
    .element(panel().getByRole('button', { name: 'Recover request', exact: true }))
    .not.toBeInTheDocument()
  await expect
    .element(
      panel().getByText(
        'The request outcome is unknown. Recover the same request before starting a new test.',
        { exact: true },
      ),
    )
    .not.toBeInTheDocument()
  await expect.element(task()).toHaveAttribute('readonly')
  await task().click()
  await userEvent.keyboard('Changed task')
  await expect.element(task()).toHaveValue('Review this contract.')
  const original = api.start.mock.calls[0]![0]
  api.capabilities.mockResolvedValue(createExternalAgentCapabilities({ enabled: false }))
  await rendered.queryClient.refetchQueries({
    queryKey: consoleQuery.externalAgents.capabilities.get.queryOptions({
      input: { query: { agent_id: testOverview().asset.id } },
    }).queryKey,
  })
  await expect
    .element(
      panel().getByText('External agent execution is unavailable on this deployment.', {
        exact: true,
      }),
    )
    .toBeVisible()
  await panel().getByRole('button', { name: 'Close', exact: true }).click()
  await expect.element(panel()).not.toBeInTheDocument()
  await page.getByRole('button', { name: 'Test agent', exact: true }).click()
  const retry = panel().getByRole('button', { name: 'Run test', exact: true })
  await expect.element(retry).toBeEnabled()
  await retry.click()
  await expect.element(status().getByText('Success', { exact: true })).toBeVisible()
  expect(api.start).toHaveBeenCalledTimes(2)
  expect(api.start.mock.calls[1]![0]).toEqual(original)
  expect(original.body.idempotency_key).toBeTruthy()
  expect(api.read).not.toHaveBeenCalled()
})

it('keeps a failed agent result and its error message in the result section', async () => {
  api.start.mockResolvedValue(
    testResult('failed', { error_message: 'The agent rejected this task.' }),
  )
  const rendered = await renderTestPanel()
  onTestFinished(() => rendered.queryClient.clear())
  await page.getByRole('button', { name: 'Test agent', exact: true }).click()
  await task().fill('Review this contract.')
  await panel().getByRole('button', { name: 'Run test', exact: true }).click()
  await expect.element(status().getByText('Failed', { exact: true })).toBeVisible()
  await expect
    .element(
      panel()
        .getByRole('tabpanel', { name: 'Result', exact: true })
        .getByText('The agent rejected this task.', { exact: true }),
    )
    .toBeVisible()
  expect(panel().getByText('The agent rejected this task.', { exact: true }).all()).toHaveLength(1)
  await expect.element(panel().getByRole('alert')).not.toBeInTheDocument()
  await expect.element(task()).not.toHaveAttribute('readonly')
  await expect.element(panel().getByRole('button', { name: 'Run test', exact: true })).toBeEnabled()
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
  expect(api.leave.mock.calls[0]![1]).toEqual({ context: { keepalive: true } })
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
