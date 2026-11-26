import type { ExternalTestStatusResponse } from '@dify/contracts/api/console/external-agents/types.gen'
import { page } from 'vite-plus/test/browser'
import { toast } from '@/app/notifications'
import japanese from '@/i18n/locales/ja-JP/agent-roster.json'
import chinese from '@/i18n/locales/zh-Hans/agent-roster.json'
import { createExternalAgentCapabilities } from '@/test/console/external-agents'
import { apiError, hold, networkError, setupFakeApi } from '@/test/fake-api'
import { act } from '@/test/react-act'
import { anchorId, renderTestPanel, testOverview, testResult } from './test-run-fixture'

// boundary: real translations are the visible diagnosis and action contract.
vi.mock('react-i18next', async (importOriginal) => importOriginal())

const fake = setupFakeApi({
  console: {
    externalAgents: {
      capabilities: { get: () => createExternalAgentCapabilities() },
      byAgentId: {
        tests: {
          post: () => testResult(),
          byInvocationId: { get: () => testResult() },
        },
      },
    },
    externalAgentTests: { leavePage: { post: () => ({ result: 'success' as const }) } },
  },
})
const panel = () => page.getByRole('dialog', { name: 'Test agent', exact: true })
const resultPanel = () => panel().getByRole('tabpanel', { name: 'Result', exact: true })
const task = () => panel().getByRole('textbox', { name: 'Task', exact: true })
const runButton = () => panel().getByRole('button', { name: 'Run test', exact: true })
const legacyMessage = 'Server Message context and role are required.'
const maintainerAction = 'Contact the external agent’s maintainer'

function failedReply(code: unknown, overrides: Partial<ExternalTestStatusResponse> = {}) {
  return testResult('failed', {
    error_code: 'invalid_message',
    error_message: legacyMessage,
    metadata: {
      ...testResult().metadata,
      response_issue: { source: 'external_agent_reply', code },
    },
    ...overrides,
  })
}
async function openAndRun() {
  const rendered = await renderTestPanel()
  const leave = fake.console.externalAgentTests.leavePage.post
  onTestFinished(async () => {
    await rendered.unmount()
    // Page cleanup sends its best-effort leave request asynchronously; keep the fake installed.
    await expect.poll(() => leave.mock.calls.length).toBe(1)
    rendered.queryClient.clear()
  })
  await page.getByRole('button', { name: 'Test agent', exact: true }).click()
  await task().fill('What is the well-known path for an Agent Card?')
  await runButton().click()
  return rendered
}
function usePollClock() {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
  onTestFinished(() => {
    vi.useRealTimers()
  })
}
beforeEach(() => {
  onTestFinished(() => toast.dismiss())
})

it.each([
  [
    'message_context_id_missing',
    'is missing the conversation identifier (message.contextId)',
    false,
  ],
  ['message_context_id_invalid', 'message.contextId must be a non-empty string', false],
  ['message_role_missing', 'is missing the sender role (message.role)', true],
  ['message_role_invalid', 'has an invalid sender role (message.role)', true],
  [
    'message_context_id_and_role_invalid',
    'message.contextId must be a non-empty string and message.role must be ROLE_AGENT',
    true,
  ],
] as const)(
  'explains the received reply issue %s without exposing remote diagnostics',
  async (code, detail, role) => {
    fake.console.externalAgents.byAgentId.tests.post.mockResolvedValueOnce(failedReply(code))
    await openAndRun()
    await expect.element(panel().getByRole('status')).toMatchTextContent('Failed')
    await expect
      .element(resultPanel())
      .toMatchTextContent('Dify received the external agent’s reply')
    await expect.element(resultPanel()).toMatchTextContent(detail)
    await expect.element(resultPanel()).toMatchTextContent(maintainerAction)
    await expect.element(resultPanel()).not.toMatchTextContent(legacyMessage)
    if (role) {
      await expect.element(resultPanel()).toMatchTextContent('ROLE_AGENT')
      await expect
        .element(resultPanel())
        .toMatchTextContent('separate from Role in Dify’s agent details')
    } else await expect.element(resultPanel()).not.toMatchTextContent('message.role')
    await expect.element(task()).not.toHaveAttribute('readonly')
    await expect.element(runButton()).toBeEnabled()
    expect(fake.console.externalAgents.byAgentId.tests.post).toHaveBeenCalledTimes(1)
    expect(fake.console.externalAgents.byAgentId.tests.byInvocationId.get).not.toHaveBeenCalled()
  },
)

it.each(['invalid_response', 'invalid_stream_event'])(
  'keeps the %s error code compatible with the structured diagnosis',
  async (errorCode) => {
    fake.console.externalAgents.byAgentId.tests.post.mockResolvedValueOnce(
      failedReply('message_role_invalid', { error_code: errorCode }),
    )
    await openAndRun()
    await expect
      .element(resultPanel())
      .toMatchTextContent('has an invalid sender role (message.role)')
    expect(fake.console.externalAgents.byAgentId.tests.post).toHaveBeenCalledTimes(1)
  },
)

it('uses safe generic reply guidance for a future code and never displays untrusted metadata or prose', async () => {
  const response = failedReply('future_code https://secret.example.test?token=do-not-display')
  response.metadata.response_issue = {
    source: 'external_agent_reply',
    code: 'future_code https://secret.example.test?token=do-not-display',
    path: '<script>do-not-display</script>',
    message: 'password=do-not-display',
  }
  fake.console.externalAgents.byAgentId.tests.post.mockResolvedValueOnce(response)
  await openAndRun()
  await expect.element(resultPanel()).toMatchTextContent('its message format is invalid')
  await expect.element(resultPanel()).toMatchTextContent(maintainerAction)
  await expect.element(resultPanel()).not.toMatchTextContent('do-not-display')
  await expect.element(resultPanel()).not.toMatchTextContent(legacyMessage)
})

it.each([
  { label: 'absent issue', issue: undefined },
  { label: 'null issue', issue: null },
  { label: 'legacy scalar', issue: 'message_context_id_missing' },
  { label: 'array issue', issue: [] },
  { label: 'wrong source', issue: { source: 'other', code: 'message_context_id_missing' } },
  { label: 'absent code', issue: { source: 'external_agent_reply' } },
  { label: 'non-string code', issue: { source: 'external_agent_reply', code: null } },
  { label: 'empty code', issue: { source: 'external_agent_reply', code: '' } },
])('retains the existing fallback for $label', async ({ issue }) => {
  fake.console.externalAgents.byAgentId.tests.post.mockResolvedValueOnce(
    testResult('failed', {
      error_code: 'invalid_response',
      error_message: legacyMessage,
      metadata: {
        ...testResult().metadata,
        ...(issue === undefined ? {} : { response_issue: issue }),
      },
    }),
  )
  await openAndRun()
  await expect.element(resultPanel()).toHaveTextContent(legacyMessage)
  await expect.element(resultPanel()).not.toMatchTextContent('Dify received')
})

it('does not infer reply provenance from a different failure code', async () => {
  fake.console.externalAgents.byAgentId.tests.post.mockResolvedValueOnce(
    failedReply('message_context_id_missing', { error_code: 'connection_failed' }),
  )
  await openAndRun()
  await expect.element(resultPanel()).toHaveTextContent(legacyMessage)
  await expect.element(resultPanel()).not.toMatchTextContent(maintainerAction)
})

it.each([
  ['offline', () => networkError()],
  ['gateway', () => apiError({ status: 502, message: 'Bad Gateway' })],
  ['authorization', () => apiError({ status: 403, message: 'Console permission denied.' })],
] as const)(
  'does not blame an external reply for a %s submission failure',
  async (_label, error) => {
    fake.console.externalAgents.byAgentId.tests.post.mockRejectedValueOnce(error())
    await openAndRun()
    await expect.element(panel().getByRole('status')).toMatchTextContent('Error')
    await expect.element(resultPanel()).not.toMatchTextContent('Dify received')
    await expect.element(resultPanel()).not.toMatchTextContent(maintainerAction)
    expect(fake.console.externalAgents.byAgentId.tests.post).toHaveBeenCalledTimes(1)
  },
)

it('renders a polled diagnosis, retains it on reopen, and clears it on a new successful run', async () => {
  usePollClock()
  fake.console.externalAgents.byAgentId.tests.byInvocationId.get.mockResolvedValueOnce(
    failedReply('message_context_id_missing'),
  )
  await openAndRun()
  await expect.element(panel().getByRole('status')).toMatchTextContent('Running')
  await expect
    .element(panel().getByRole('button', { name: 'Stop test', exact: true }))
    .toBeEnabled()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_500)
  })
  await expect.element(resultPanel()).toMatchTextContent('is missing the conversation identifier')
  expect(
    fake.console.externalAgents.byAgentId.tests.byInvocationId.get,
  ).toHaveBeenCalledExactlyOnceWith({
    params: { agent_id: testOverview().asset.id, invocation_id: anchorId },
  })
  await panel().getByRole('button', { name: 'Close', exact: true }).click()
  await expect.element(panel()).not.toBeInTheDocument()
  await page.getByRole('button', { name: 'Test agent', exact: true }).click()
  await expect.element(resultPanel()).toMatchTextContent('is missing the conversation identifier')
  fake.console.externalAgents.byAgentId.tests.post.mockResolvedValueOnce(testResult('succeeded'))
  await runButton().click()
  await expect.element(resultPanel()).toHaveTextContent('Result supplied by the agent.')
  await expect.element(resultPanel()).not.toMatchTextContent(maintainerAction)
  expect(fake.console.externalAgents.byAgentId.tests.post).toHaveBeenCalledTimes(2)
})

it('clears the diagnosis when the task or configuration changes and ignores an old result', async () => {
  fake.console.externalAgents.byAgentId.tests.post.mockResolvedValueOnce(
    failedReply('message_context_id_missing'),
  )
  const rendered = await openAndRun()
  await expect.element(resultPanel()).toMatchTextContent(maintainerAction)
  await task().fill('A changed task')
  await expect.element(panel().getByRole('status')).not.toBeInTheDocument()
  fake.console.externalAgents.byAgentId.tests.post.mockResolvedValueOnce(testResult())
  usePollClock()
  const read = hold(fake.console.externalAgents.byAgentId.tests.byInvocationId.get)
  await runButton().click()
  await expect.element(panel().getByRole('status')).toMatchTextContent('Running')
  await expect
    .element(panel().getByRole('button', { name: 'Stop test', exact: true }))
    .toBeEnabled()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_500)
  })
  await read.arrived
  const overview = testOverview()
  await rendered.rerenderOverview({
    ...overview,
    asset: { ...overview.asset, test_display_generation: 2 },
  })
  read.resolve(failedReply('message_context_id_missing'))
  await expect.element(panel().getByRole('status')).not.toBeInTheDocument()
  await expect.element(panel()).not.toMatchTextContent(maintainerAction)
  await expect.element(task()).toHaveValue('A changed task')
  expect(fake.console.externalAgents.byAgentId.tests.post).toHaveBeenCalledTimes(2)
})

it.each([
  ['network', () => networkError()],
  ['authorization', () => apiError({ status: 403, message: 'Console permission denied.' })],
])('does not infer a reply when a %s result read fails', async (_label, error) => {
  usePollClock()
  fake.console.externalAgents.byAgentId.tests.byInvocationId.get.mockRejectedValueOnce(error())
  await openAndRun()
  await expect.element(panel().getByRole('status')).toMatchTextContent('Running')
  await expect
    .element(panel().getByRole('button', { name: 'Stop test', exact: true }))
    .toBeEnabled()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_500)
  })
  await expect
    .poll(() => fake.console.externalAgents.byAgentId.tests.byInvocationId.get.mock.calls.length)
    .toBe(1)
  await expect.element(panel()).not.toMatchTextContent('Dify received')
  await expect.element(panel()).not.toMatchTextContent(maintainerAction)
  expect(fake.console.externalAgents.byAgentId.tests.post).toHaveBeenCalledTimes(1)
})

it('does not render failure diagnostics from metadata on a successful result', async () => {
  fake.console.externalAgents.byAgentId.tests.post.mockResolvedValueOnce(
    failedReply('message_context_id_missing', {
      state: 'succeeded',
      outputs: { text: 'Successful reply.' },
    }),
  )
  await openAndRun()
  await expect.element(resultPanel()).toHaveTextContent('Successful reply.')
  await expect.element(resultPanel()).not.toMatchTextContent(maintainerAction)
})

it.each([
  { locale: 'zh-Hans', resources: chinese, received: 'Dify 已收到外部 Agent 回复' },
  { locale: 'ja-JP', resources: japanese, received: 'Dify は外部エージェントの応答を受信しました' },
])('localizes the received reply diagnosis in $locale', async ({ locale, resources, received }) => {
  fake.console.externalAgents.byAgentId.tests.post.mockResolvedValueOnce(
    failedReply('message_context_id_missing'),
  )
  const rendered = await openAndRun()
  await expect.element(resultPanel()).toMatchTextContent(maintainerAction)
  rendered.i18n.addResourceBundle(locale, 'agentRoster', resources)
  await rendered.i18n.changeLanguage(locale)
  const localizedResult = page.getByRole('tabpanel', {
    name: resources['external.overview.testRun.result'],
    exact: true,
  })
  await expect.element(localizedResult).toMatchTextContent(received)
  await expect
    .element(localizedResult)
    .toHaveTextContent(resources['external.overview.testRun.responseContextMissing'])
  await expect.element(localizedResult).not.toMatchTextContent(legacyMessage)
  expect(fake.console.externalAgents.byAgentId.tests.post).toHaveBeenCalledTimes(1)
})
