import type { ExternalAgentVerificationFailureDetailsResponse } from '@dify/contracts/api/console/external-agents/types.gen'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { toExternalAgentOverview } from '@/features/agent-v2/external-agent/model'
import { EditExternalAgentConnection } from '@/features/agent-v2/external-agent/overview/edit-connection'
import agentRoster from '@/i18n/locales/en-US/agent-roster.json'
import common from '@/i18n/locales/en-US/common.json'
import {
  createExternalAgentCapabilities,
  createExternalAgentDetail,
  createExternalAgentReferences,
} from '@/test/console/external-agents'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { apiError, setupFakeApi } from '@/test/fake-api'
import { createTestNavigation } from '@/test/next-navigation'
import { ConnectExternalAgent } from '../components/connect-external-agent'
import { createExternalOperation, createExternalVerification } from './external-connection-fixture'

// boundary: English translations make the visible field errors the acceptance contract.
vi.mock('react-i18next', async (importOriginal) => importOriginal())

const detail = createExternalAgentDetail()
const fake = setupFakeApi({
  console: {
    externalAgents: {
      capabilities: { get: () => createExternalAgentCapabilities() },
      verify: { post: () => createExternalVerification() },
      post: () => createExternalOperation(),
      byAgentId: {
        get: () => detail,
        connection: { put: () => createExternalOperation({ kind: 'connection' }) },
        references: { get: () => createExternalAgentReferences() },
      },
    },
  },
})

async function setup(editing: boolean) {
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    resources: { 'en-US': { agentRoster, common } },
    keySeparator: false,
    interpolation: { escapeValue: false },
  })
  const { queryClient, wrapper: QueryProvider } = createConsoleQueryWrapper({
    currentWorkspace: { role: 'owner' },
    accountProfile: { id: '11111111-1111-4111-8111-111111111111' },
  })
  const { NavigationProvider } = createTestNavigation()
  onTestFinished(() => queryClient.clear())
  await render(
    <QueryProvider>
      <NavigationProvider>
        <I18nextProvider i18n={i18n}>
          <div className="p-8">
            {editing ? (
              <EditExternalAgentConnection overview={toExternalAgentOverview(detail)} />
            ) : (
              <ConnectExternalAgent />
            )}
          </div>
        </I18nextProvider>
      </NavigationProvider>
    </QueryProvider>,
  )
  const name = editing ? 'Edit connection' : 'Connect external agent'
  const trigger = page.getByRole('button', { name, exact: true })
  await expect.element(trigger).toBeEnabled()
  await trigger.click()
  const dialog = page.getByRole('dialog', { name, exact: true })
  await expect.element(dialog).toBeVisible()
  const endpoint = dialog.getByRole('textbox', { name: 'A2A endpoint', exact: true })
  if (editing) await expect.element(endpoint).toHaveValue('https://agents.example.test/contract')
  return {
    dialog,
    endpoint,
    verify: dialog.getByRole('button', { name: 'Verify connection', exact: true }),
  }
}

function rejectVerification(details?: ExternalAgentVerificationFailureDetailsResponse) {
  fake.console.externalAgents.verify.post.mockRejectedValueOnce(
    apiError({
      code: 'verification_failed',
      status: 400,
      message: 'Untrusted remote diagnostic: invalid token, password=do-not-display',
      details: details ? { details } : undefined,
    }),
  )
}

it.each([
  [false, 'connection_failed'],
  [true, 'invalid_agent_card'],
] as const)(
  'identifies a non-A2A URL and retries unchanged settings (editing=%s, reason=%s)',
  async (editing, reason) => {
    rejectVerification({ reason, subreason: 'invalid_a2a_endpoint' })
    const { dialog, endpoint, verify } = await setup(editing)
    await endpoint.fill('https://ordinary-website.example.test')
    await verify.click()
    await expect
      .element(endpoint)
      .toHaveAccessibleDescription('This URL is not a valid A2A endpoint.')
    await expect.element(endpoint).toBeInvalid()
    await expect.element(dialog.getByRole('alert')).not.toBeInTheDocument()
    expect(fake.console.externalAgents.post).not.toHaveBeenCalled()
    expect(fake.console.externalAgents.byAgentId.connection.put).not.toHaveBeenCalled()
    const firstRequest = fake.console.externalAgents.verify.post.mock.calls[0]![0]
    if (editing) await verify.click()
    else {
      await endpoint.click()
      await userEvent.keyboard('{Enter}')
    }
    await expect.poll(() => fake.console.externalAgents.verify.post.mock.calls.length).toBe(2)
    expect(fake.console.externalAgents.verify.post.mock.calls[1]![0]).toEqual(firstRequest)
    if (editing)
      await expect
        .element(dialog.getByRole('button', { name: 'Save changes', exact: true }))
        .toBeEnabled()
    else
      await expect
        .element(dialog.getByRole('textbox', { name: 'Name', exact: true }))
        .toHaveValue('Contract Review Agent')
  },
)

it.each([
  ['connection_failed', undefined, 'Could not reach the agent.'],
  ['invalid_agent_card', undefined, 'Could not verify the Agent Card.'],
  ['unsupported_protocol', undefined, 'This endpoint does not provide a supported A2A connection.'],
  ['connection_failed', 'connection_timeout', 'The connection timed out. Try again later.'],
  [
    'connection_failed',
    'tls_error',
    'Could not establish a secure connection. Check the service certificate.',
  ],
  ['connection_failed', 'rate_limited', 'Too many requests. Try again later.'],
  [
    'connection_failed',
    'remote_service_error',
    'The external service is temporarily unavailable. Try again later.',
  ],
  [
    'authentication_failed',
    'access_denied',
    'Access denied. Check your permissions for this service.',
  ],
  [
    'unsupported_protocol',
    'unsupported_protocol_version',
    'This agent’s protocol version is not supported.',
  ],
  [
    'unsupported_protocol',
    'unsupported_transport',
    'This agent’s transport method is not supported.',
  ],
  [
    'unsupported_protocol',
    'unsupported_required_extension',
    'A required extension for this agent is not supported.',
  ],
  ['connection_failed', 'future_subreason', 'Could not reach the agent.'],
  ['invalid_agent_card', 'future_subreason', 'Could not verify the Agent Card.'],
  [
    'unsupported_protocol',
    'future_subreason',
    'This endpoint does not provide a supported A2A connection.',
  ],
] satisfies [
  ExternalAgentVerificationFailureDetailsResponse['reason'],
  string | undefined,
  string,
][])(
  'keeps %s/%s in bottom feedback without blaming a field',
  async (reason, subreason, message) => {
    rejectVerification({ reason, ...(subreason ? { subreason } : {}) })
    const { dialog, endpoint, verify } = await setup(false)
    await endpoint.fill('https://agents.example.test/contract')
    await verify.click()
    await expect.element(dialog.getByRole('alert')).toMatchTextContent(message)
    await expect.element(endpoint).not.toBeInvalid()
    await expect
      .element(dialog.getByRole('combobox', { name: 'Authentication', exact: true }))
      .not.toHaveAttribute('aria-invalid', 'true')
    await expect.element(dialog).not.toMatchTextContent('Untrusted remote diagnostic')
    expect(fake.console.externalAgents.post).not.toHaveBeenCalled()
  },
)

it.each([
  [undefined, 'Authentication failed.'],
  ['future_subreason', 'Authentication failed.'],
  ['authentication_required', 'This service requires authentication.'],
  ['token_invalid_or_expired', 'Authentication failed.'],
  [
    'unsupported_authentication',
    'The authentication method required by this service is not supported.',
  ],
] as const)(
  'explains authentication %s at its selector with None selected',
  async (subreason, message) => {
    rejectVerification({ reason: 'authentication_failed', ...(subreason ? { subreason } : {}) })
    const { dialog, endpoint, verify } = await setup(false)
    await endpoint.fill('https://agents.example.test/contract')
    await verify.click()
    const authentication = dialog.getByRole('combobox', { name: 'Authentication', exact: true })
    await expect.element(authentication).toHaveAccessibleDescription(message)
    await expect.element(authentication).toHaveAttribute('aria-invalid', 'true')
    await expect.element(endpoint).not.toBeInvalid()
    await expect.element(dialog.getByRole('alert')).not.toBeInTheDocument()
    await authentication.click()
    await page.getByRole('option', { name: 'Bearer token', exact: true }).click()
    await expect.element(authentication).not.toHaveAttribute('aria-invalid', 'true')
    expect(fake.console.externalAgents.post).not.toHaveBeenCalled()
  },
)

it.each([false, true])(
  'attributes an explicit invalid-token response to a sent or saved Bearer credential (editing=%s)',
  async (editing) => {
    rejectVerification({ reason: 'authentication_failed', subreason: 'token_invalid_or_expired' })
    const { dialog, endpoint, verify } = await setup(editing)
    await endpoint.fill('https://updated.example.test/agent')
    if (!editing) {
      await dialog.getByRole('combobox', { name: 'Authentication', exact: true }).click()
      await page.getByRole('option', { name: 'Bearer token', exact: true }).click()
      await dialog.getByLabelText('Token', { exact: true }).fill('replacement-token')
    }
    await verify.click()
    const token = dialog.getByLabelText('Token', { exact: true })
    await expect
      .element(token)
      .toHaveAccessibleDescription(
        editing
          ? 'Leave empty to keep the saved token. The Bearer token is invalid or has expired.'
          : 'The Bearer token is invalid or has expired.',
      )
    await expect.element(token).toBeInvalid()
    await expect.element(endpoint).not.toBeInvalid()
    expect(fake.console.externalAgents.verify.post).toHaveBeenCalledExactlyOnceWith({
      body: {
        endpoint: 'https://updated.example.test/agent',
        auth_type: 'bearer',
        credential_action: editing ? 'keep' : 'replace',
        ...(editing
          ? {
              agent_id: detail.asset.id,
              expected_connection_revision_id: detail.connection.revision_id,
            }
          : { credential: 'replacement-token' }),
      },
    })
    expect(fake.console.externalAgents.post).not.toHaveBeenCalled()
    expect(fake.console.externalAgents.byAgentId.connection.put).not.toHaveBeenCalled()
  },
)

it('falls back to Authentication when an authentication-required response conflicts with an existing Bearer credential', async () => {
  rejectVerification({ reason: 'authentication_failed', subreason: 'authentication_required' })
  const { dialog, endpoint, verify } = await setup(true)
  await endpoint.fill('https://updated.example.test/agent')
  await verify.click()
  await expect
    .element(dialog.getByRole('combobox', { name: 'Authentication', exact: true }))
    .toHaveAccessibleDescription('Authentication failed.')
  await expect.element(dialog.getByLabelText('Token', { exact: true })).not.toBeInvalid()
})

it('localizes safe Card diagnostics and retains generic Card feedback for future validation codes', async () => {
  rejectVerification({
    reason: 'invalid_agent_card',
    subreason: 'agent_card_field_invalid',
    card_errors: [
      { path: 'skills[0].description', code: 'missing' },
      { path: 'supportedInterfaces[0].url', code: 'invalid' },
      { path: 'name', code: 'future_code' },
      { path: '<script>secret</script>', code: 'invalid' },
    ],
  })
  const { dialog, endpoint, verify } = await setup(false)
  await endpoint.fill('https://agents.example.test/contract')
  await verify.click()
  const alert = dialog.getByRole('alert')
  await expect.element(alert).toMatchTextContent('Could not verify the Agent Card.')
  await expect.element(alert).toMatchTextContent('skills[0].description is required.')
  await expect.element(alert).toMatchTextContent('supportedInterfaces[0].url is invalid.')
  await expect.element(alert).not.toMatchTextContent('name')
  await expect.element(alert).not.toMatchTextContent('secret')
  await expect.element(endpoint).not.toBeInvalid()
})

it.each([undefined, 'future_reason'])(
  'uses only generic feedback for an unknown reason (%s)',
  async (reason) => {
    if (reason) {
      fake.console.externalAgents.verify.post.mockRejectedValueOnce(
        apiError({
          code: 'verification_failed',
          status: 400,
          message: 'Untrusted remote diagnostic',
          details: { details: { reason, subreason: 'token_invalid_or_expired' } },
        }),
      )
    } else rejectVerification()
    const { dialog, endpoint, verify } = await setup(false)
    await endpoint.fill('https://agents.example.test/contract')
    await verify.click()
    await expect
      .element(dialog.getByRole('alert'))
      .toHaveTextContent('Could not verify the connection.')
    await expect.element(endpoint).not.toBeInvalid()
    await expect.element(dialog).not.toMatchTextContent('Untrusted remote diagnostic')
  },
)

it('keeps a Console permission failure out of external Agent authentication feedback', async () => {
  fake.console.externalAgents.verify.post.mockRejectedValueOnce(
    apiError({ status: 403, code: 'forbidden', message: 'Console workspace permission denied.' }),
  )
  const { dialog, endpoint, verify } = await setup(false)
  await endpoint.fill('https://agents.example.test/contract')
  await verify.click()
  await expect.poll(() => fake.console.externalAgents.verify.post.mock.calls.length).toBe(1)
  await expect.element(verify).toBeEnabled()
  await expect.element(dialog.getByRole('alert')).not.toBeInTheDocument()
  await expect
    .element(dialog.getByRole('combobox', { name: 'Authentication', exact: true }))
    .not.toHaveAttribute('aria-invalid', 'true')
  await expect
    .element(dialog.getByRole('textbox', { name: 'Name', exact: true }))
    .not.toBeInTheDocument()
})
