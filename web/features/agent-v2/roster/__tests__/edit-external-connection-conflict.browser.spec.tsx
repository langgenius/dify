import type { ExternalAgentDetailResponse } from '@dify/contracts/api/console/external-agents/types.gen'
import { ORPCError } from '@orpc/client'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { toExternalAgentOverview } from '@/features/agent-v2/external-agent/model'
import { EditExternalAgentConnection } from '@/features/agent-v2/external-agent/overview/edit-connection'
import agentRoster from '@/i18n/locales/en-US/agent-roster.json'
import common from '@/i18n/locales/en-US/common.json'
import { createHttpError } from '@/service/http-error'
import {
  createExternalAgentCapabilities,
  createExternalAgentDetail,
  createExternalAgentReferences,
} from '@/test/console/external-agents'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { createExternalOperation, createExternalVerification } from './external-connection-fixture'

const requests = vi.hoisted(() => ({
  detail: vi.fn(),
  capabilities: vi.fn(),
  verify: vi.fn(),
  save: vi.fn(),
  references: vi.fn(),
}))
// boundary: restore real English labels for browser-driven forms.
vi.mock('react-i18next', async (importOriginal) => importOriginal())
// boundary: replace Console transport responses and retain generated mutation/cache policies.
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'externalAgents.byAgentId.get': requests.detail,
      'externalAgents.capabilities.get': requests.capabilities,
      'externalAgents.verify.post': requests.verify,
      'externalAgents.byAgentId.connection.put': requests.save,
      'externalAgents.byAgentId.references.get': requests.references,
    }),
  }
})

let current: ExternalAgentDetailResponse
const dialog = () => page.getByRole('dialog', { name: 'Edit connection', exact: true })
const endpoint = () => dialog().getByRole('textbox', { name: 'A2A endpoint', exact: true })
const token = () => dialog().getByLabelText('Token', { exact: true })
const verify = () => dialog().getByRole('button', { name: 'Verify connection', exact: true })
const comparison = () => dialog().getByRole('table')

async function expectComparisonRow(
  label: string,
  yours: string | Record<string, unknown>,
  latest: string | Record<string, unknown>,
) {
  const row = comparison()
    .getByRole('row')
    .filter({
      has: page.getByRole('rowheader', { name: label, exact: true }),
    })
  for (const [index, expected] of [yours, latest].entries()) {
    const cell = row.getByRole('cell').nth(index)
    await expect.element(cell).toBeVisible()
    if (typeof expected === 'string') await expect.element(cell).toHaveTextContent(expected)
    else expect(JSON.parse(cell.element().textContent ?? '')).toEqual(expected)
  }
}

async function setup() {
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
  onTestFinished(() => queryClient.clear())
  await render(
    <QueryProvider>
      <I18nextProvider i18n={i18n}>
        <div className="p-8">
          <EditExternalAgentConnection overview={toExternalAgentOverview(current)} />
        </div>
      </I18nextProvider>
    </QueryProvider>,
  )
  const trigger = page.getByRole('button', { name: 'Edit connection', exact: true })
  await trigger.click()
  await expect.element(endpoint()).toHaveValue('https://agents.example.test/contract')
  return { trigger }
}

beforeEach(({ onTestFinished }) => {
  onTestFinished(guardUnexpectedFetch())
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-20T10:20:00Z'))
  onTestFinished(() => {
    vi.useRealTimers()
  })
  current = createExternalAgentDetail()
  requests.detail.mockReset().mockImplementation(() => current)
  requests.capabilities.mockReset().mockResolvedValue(createExternalAgentCapabilities())
  requests.verify.mockReset().mockResolvedValue(createExternalVerification())
  requests.save.mockReset().mockResolvedValue(createExternalOperation({ kind: 'connection' }))
  requests.references.mockReset().mockResolvedValue(createExternalAgentReferences())
})

const revision2 = '88888888-8888-4888-8888-888888888888'
const revision3 = '77777777-7777-4777-8777-777777777777'

function advanceConnection(
  revision = revision2,
  name: string | null = 'Jamie Lee',
  overrides: Partial<ExternalAgentDetailResponse['connection']> = {},
) {
  current = createExternalAgentDetail({
    connection: {
      ...current.connection,
      revision_id: revision,
      endpoint: 'https://latest.example.test/agent',
      auth_type: 'none',
      has_credential: false,
      saved_at: '2026-11-20T10:18:00Z',
      saved_by: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name },
      verified_at: '2026-11-20T09:00:00Z',
      ...overrides,
    },
  })
}

it('shows only changed public properties and omits equal endpoint, authentication and credential values', async () => {
  const originalCard = {
    name: 'Original public agent',
    description: 'Original service details.',
    provider: { organization: 'Original provider' },
    version: '1.0.0',
    documentationUrl: 'https://original.example.test/docs',
    skills: [{ id: 'review', name: 'Contract review', description: 'Review contracts.' }],
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['application/json'],
    supportedInterfaces: [{ protocolVersion: '1.0', transport: 'HTTP+JSON' }],
    capabilities: { streaming: false },
    iconUrl: 'https://original.example.test/icon.png',
  }
  const latestCard = {
    ...originalCard,
    name: 'Latest public agent',
    provider: { organization: 'Latest provider' },
    version: '2.0.0',
    skills: [{ id: 'rewrite', name: 'Clause rewrite', description: 'Rewrite risky clauses.' }],
  }
  current = createExternalAgentDetail({
    connection: {
      ...current.connection,
      card: { ...originalCard, private_extension: { secret: 'original-private-card-value' } },
    },
  })
  requests.verify.mockRejectedValueOnce(new ORPCError('conflict', { status: 409 }))
  await setup()
  await token().fill('same-settings-replacement-secret')
  advanceConnection(revision2, 'Jamie Lee', {
    endpoint: current.connection.endpoint,
    auth_type: 'bearer',
    has_credential: true,
    interface_url: 'https://latest.example.test/interface',
    profile: 'a2a_v2',
    auth_check: 'passed_for_read_endpoint',
    card: { ...latestCard, private_extension: { secret: 'latest-private-card-value' } },
    capabilities: { streaming: true, traceability_supported: false },
  })
  await verify().click()
  await expectComparisonRow(
    'Interface URL',
    'https://agents.example.test/contract',
    'https://latest.example.test/interface',
  )
  await expectComparisonRow('Protocol profile', 'a2a_v1', 'a2a_v2')
  await expectComparisonRow('Authentication verification', 'verified', 'passed_for_read_endpoint')
  await expectComparisonRow('Agent Card', originalCard, latestCard)
  await expectComparisonRow(
    'Capabilities',
    { traceability_supported: true },
    { streaming: true, traceability_supported: false },
  )
  expect(comparison().getByRole('rowheader').elements()).toHaveLength(5)
  for (const label of ['A2A endpoint', 'Authentication', 'Credential configured']) {
    await expect
      .element(comparison().getByRole('rowheader', { name: label, exact: true }))
      .not.toBeInTheDocument()
  }
  await expect
    .element(comparison())
    .not.toMatchTextContent(/private-card-value|same-settings-replacement-secret/)
  await expect
    .element(
      dialog().getByText(
        'Service details reflect the connection loaded when editing started, or your last successful verification.',
        { exact: true },
      ),
    )
    .toBeVisible()
  expect(requests.save).not.toHaveBeenCalled()
})

it('compares the last successful verification with the latest saved service details without exposing credentials or proof', async () => {
  const verifiedCard = {
    name: 'Successfully verified agent',
    description: 'Details returned by the last successful verification.',
    provider: { organization: 'Verified provider' },
    skills: [],
  }
  const latestCard = {
    name: 'Newer saved agent',
    description: 'Latest saved service details.',
    skills: [],
  }
  const proof = createExternalVerification({
    interface_url: 'https://verified.example.test/interface',
    auth_check: 'passed_for_read_endpoint',
    card: {
      ...verifiedCard,
      credential_ciphertext: 'private-encrypted-credential',
      private_extension: { token: 'private-card-token' },
    },
    capabilities: { streaming: false, traceability_supported: true },
  })
  requests.verify.mockResolvedValueOnce(proof)
  requests.save.mockRejectedValueOnce(new ORPCError('conflict', { status: 409 }))
  await setup()
  await endpoint().fill('https://my-change.example.test/agent')
  await token().fill('private-replacement-credential')
  await verify().click()
  await expect
    .element(dialog().getByRole('button', { name: 'Save changes', exact: true }))
    .toBeEnabled()
  advanceConnection(revision2, 'Jamie Lee', {
    interface_url: 'https://latest.example.test/interface',
    profile: 'a2a_v2',
    auth_check: 'not_exercised',
    card: { ...latestCard, credential_ciphertext: 'latest-encrypted-credential' },
    capabilities: { streaming: true, traceability_supported: false },
  })
  await dialog().getByRole('button', { name: 'Save changes', exact: true }).click()
  await expectComparisonRow(
    'A2A endpoint',
    'https://my-change.example.test/agent',
    'https://latest.example.test/agent',
  )
  await expectComparisonRow('Authentication', 'Bearer token', 'None')
  await expectComparisonRow('Credential configured', 'true', 'false')
  await expectComparisonRow(
    'Interface URL',
    proof.interface_url,
    'https://latest.example.test/interface',
  )
  await expectComparisonRow('Protocol profile', 'a2a_v1', 'a2a_v2')
  await expectComparisonRow('Authentication verification', proof.auth_check, 'not_exercised')
  await expectComparisonRow('Agent Card', verifiedCard, latestCard)
  await expectComparisonRow('Capabilities', proof.capabilities, {
    streaming: true,
    traceability_supported: false,
  })
  await expect
    .element(comparison())
    .not.toMatchTextContent(
      /private-replacement-credential|private-card-token|encrypted-credential|credential_ciphertext|private_extension/,
    )
  await expect.element(comparison()).not.toMatchTextContent(proof.verification_id)
  await expect.element(comparison()).not.toMatchTextContent(proof.expires_at)
  await expect.element(token()).toHaveValue('')
  expect(requests.verify).toHaveBeenCalledTimes(1)
  expect(requests.save).toHaveBeenCalledTimes(1)
})

it('rebases an equal Verify conflict without a comparison and lets the user verify and save the latest revision', async () => {
  const provider = { organization: 'Same service', url: 'https://same.example.test' }
  current = createExternalAgentDetail({
    connection: {
      ...current.connection,
      card: {
        name: 'Same public agent',
        provider,
        skills: [],
        private_extension: 'old-private-value',
      },
      capabilities: { streaming: true, extensions: { first: true, second: false } },
    },
  })
  requests.verify.mockRejectedValueOnce(new ORPCError('conflict', { status: 409 }))
  await setup()
  await endpoint().fill('https://my-change.example.test/agent')
  advanceConnection(revision2, 'New saver', {
    endpoint: 'https://my-change.example.test/agent',
    auth_type: 'bearer',
    has_credential: true,
    card: {
      skills: [],
      provider: { url: provider.url, organization: provider.organization },
      name: 'Same public agent',
      private_extension: 'new-private-value',
    },
    capabilities: { extensions: { second: false, first: true }, streaming: true },
  })
  await verify().click()
  await expect.poll(() => requests.detail.mock.calls.length).toBe(2)
  await expect.element(verify()).toBeEnabled()
  await expect.element(comparison()).not.toBeInTheDocument()
  await expect
    .element(dialog().getByText('This connection was updated by someone else.', { exact: true }))
    .not.toBeInTheDocument()
  await expect.element(endpoint()).toHaveValue('https://my-change.example.test/agent')
  await expect.element(token()).toHaveValue('')
  expect(requests.verify).toHaveBeenCalledTimes(1)
  expect(requests.save).not.toHaveBeenCalled()
  await verify().click()
  await expect
    .element(dialog().getByRole('button', { name: 'Save changes', exact: true }))
    .toBeEnabled()
  expect(requests.verify.mock.calls[1]![0].body).toEqual({
    endpoint: 'https://my-change.example.test/agent',
    auth_type: 'bearer',
    credential_action: 'keep',
    agent_id: current.asset.id,
    expected_connection_revision_id: revision2,
  })
  await dialog().getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect.element(dialog()).not.toBeInTheDocument()
  expect(requests.save).toHaveBeenCalledTimes(1)
  expect(requests.save.mock.calls[0]![0].body.expected_revision_id).toBe(revision2)
})

it('invalidates an equal Save conflict proof, retains the token and saves only after fresh verification', async () => {
  const originalProof = createExternalVerification()
  const refreshedProof = createExternalVerification({
    verification_id: '99999999-9999-4999-8999-999999999999',
  })
  requests.verify.mockResolvedValueOnce(originalProof).mockResolvedValueOnce(refreshedProof)
  requests.save.mockRejectedValueOnce(new ORPCError('conflict', { status: 409 }))
  await setup()
  await endpoint().fill('https://my-change.example.test/agent')
  await token().fill('retained-save-token')
  await verify().click()
  await expect
    .element(dialog().getByRole('button', { name: 'Save changes', exact: true }))
    .toBeEnabled()
  advanceConnection(revision2, 'New saver', {
    endpoint: 'https://my-change.example.test/agent',
    auth_type: 'bearer',
    has_credential: true,
    interface_url: originalProof.interface_url,
    auth_check: originalProof.auth_check,
    card: originalProof.card,
    capabilities: originalProof.capabilities,
  })
  await dialog().getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect.element(verify()).toBeEnabled()
  await expect.element(comparison()).not.toBeInTheDocument()
  await expect
    .element(dialog().getByText('This connection was updated by someone else.', { exact: true }))
    .not.toBeInTheDocument()
  await expect.element(endpoint()).toHaveValue('https://my-change.example.test/agent')
  await expect.element(token()).toHaveValue('retained-save-token')
  expect(requests.verify).toHaveBeenCalledTimes(1)
  expect(requests.save).toHaveBeenCalledTimes(1)
  const originalSave = requests.save.mock.calls[0]![0].body
  await verify().click()
  await expect
    .element(dialog().getByRole('button', { name: 'Save changes', exact: true }))
    .toBeEnabled()
  expect(requests.verify.mock.calls[1]![0].body).toEqual({
    endpoint: 'https://my-change.example.test/agent',
    auth_type: 'bearer',
    credential_action: 'replace',
    credential: 'retained-save-token',
    agent_id: current.asset.id,
    expected_connection_revision_id: revision2,
  })
  expect(requests.save).toHaveBeenCalledTimes(1)
  await dialog().getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect.element(dialog()).not.toBeInTheDocument()
  expect(requests.save).toHaveBeenCalledTimes(2)
  expect(requests.save.mock.calls[1]![0].body).toEqual({
    verification_id: refreshedProof.verification_id,
    expected_revision_id: revision2,
    idempotency_key: expect.any(String),
  })
  expect(requests.save.mock.calls[1]![0].body.idempotency_key).not.toBe(
    originalSave.idempotency_key,
  )
})

it.each(['Use latest configuration', 'Keep my edits'] as const)(
  'recovers a Verify conflict through %s and displays the revision saver audit',
  async (choice) => {
    requests.verify.mockRejectedValueOnce(
      choice === 'Use latest configuration'
        ? createHttpError(new Response(null, { status: 409 }), {
            code: 'conflict',
            message: 'The connection changed; load its current configuration.',
          })
        : new ORPCError('conflict', { status: 409, defined: true }),
    )
    await setup()
    await endpoint().fill('https://my-change.example.test/agent')
    await token().fill('discarded-token')
    advanceConnection(revision2, choice === 'Use latest configuration' ? 'Jamie Lee' : null)
    await verify().click()
    await expect
      .element(dialog().getByText('This connection was updated by someone else.', { exact: true }))
      .toBeVisible()
    await expect.element(dialog().getByText('Your changes', { exact: true })).toBeVisible()
    await expect
      .element(dialog().getByText('https://latest.example.test/agent', { exact: true }))
      .toBeVisible()
    await expect
      .element(
        dialog().getByText(
          `Saved by ${choice === 'Use latest configuration' ? 'Jamie Lee' : 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'} 2 minutes ago`,
          { exact: true },
        ),
      )
      .toBeVisible()
    expect(requests.save).not.toHaveBeenCalled()
    await dialog().getByRole('button', { name: choice, exact: true }).click()
    if (choice === 'Use latest configuration') {
      await expect.element(endpoint()).toHaveValue('https://latest.example.test/agent')
      await expect
        .element(endpoint())
        .toHaveAccessibleDescription('Saved by Jamie Lee 2 minutes ago')
      await expect.element(token()).not.toBeInTheDocument()
      await expect.element(verify()).toBeDisabled()
      await endpoint().fill('https://my-fresh-edit.example.test/agent')
    } else {
      await expect.element(endpoint()).toHaveValue('https://my-change.example.test/agent')
      await expect
        .element(endpoint())
        .toHaveAccessibleDescription(
          'Latest configuration: https://latest.example.test/agent, by aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        )
      await expect.element(token()).toHaveValue('')
      await token().fill('fresh-replacement-token')
    }
    expect(requests.verify).toHaveBeenCalledTimes(1)
    expect(requests.save).not.toHaveBeenCalled()
    await verify().click()
    await expect
      .element(dialog().getByRole('button', { name: 'Save changes', exact: true }))
      .toBeEnabled()
    expect(requests.verify).toHaveBeenLastCalledWith({
      body:
        choice === 'Use latest configuration'
          ? {
              endpoint: 'https://my-fresh-edit.example.test/agent',
              auth_type: 'none',
              credential_action: 'remove',
              agent_id: current.asset.id,
              expected_connection_revision_id: revision2,
            }
          : {
              endpoint: 'https://my-change.example.test/agent',
              auth_type: 'bearer',
              credential_action: 'replace',
              credential: 'fresh-replacement-token',
              agent_id: current.asset.id,
              expected_connection_revision_id: revision2,
            },
    })
    await dialog().getByRole('button', { name: 'Save changes', exact: true }).click()
    await expect.element(dialog()).not.toBeInTheDocument()
    expect(requests.save).toHaveBeenCalledTimes(1)
    expect(requests.save.mock.calls[0]![0].body.expected_revision_id).toBe(revision2)
  },
)

it('blocks recovery after a failed latest read and unlocks manual verification when a retry finds equal public configuration', async () => {
  requests.verify.mockRejectedValueOnce(new ORPCError('conflict', { status: 409 }))
  await setup()
  await endpoint().fill('https://my-change.example.test/agent')
  await token().fill('discard-after-read-failure')
  advanceConnection(revision2, 'Jamie Lee', {
    endpoint: 'https://my-change.example.test/agent',
    auth_type: 'bearer',
    has_credential: true,
  })
  requests.detail.mockRejectedValueOnce(new ORPCError('NOT_FOUND', { status: 404 }))
  await verify().click()
  await expect
    .element(
      dialog().getByText('Could not load the latest connection. Retry before continuing.', {
        exact: true,
      }),
    )
    .toBeVisible()
  await expect
    .element(dialog().getByRole('button', { name: 'Use latest configuration', exact: true }))
    .toBeDisabled()
  await expect
    .element(dialog().getByRole('button', { name: 'Keep my edits', exact: true }))
    .toBeDisabled()
  expect(requests.save).not.toHaveBeenCalled()
  await dialog().getByRole('button', { name: 'Retry', exact: true }).click()
  await expect.element(verify()).toBeEnabled()
  await expect.element(comparison()).not.toBeInTheDocument()
  await expect
    .element(dialog().getByRole('button', { name: 'Retry', exact: true }))
    .not.toBeInTheDocument()
  await expect.element(endpoint()).toHaveValue('https://my-change.example.test/agent')
  await expect.element(token()).toHaveValue('')
  expect(requests.verify).toHaveBeenCalledTimes(1)
  expect(requests.save).not.toHaveBeenCalled()
  await verify().click()
  await expect
    .element(dialog().getByRole('button', { name: 'Save changes', exact: true }))
    .toBeEnabled()
  expect(requests.verify.mock.calls[1]![0].body.expected_connection_revision_id).toBe(revision2)
  expect(requests.verify.mock.calls[1]![0].body.credential_action).toBe('keep')
  expect(requests.verify.mock.calls[1]![0].body).not.toHaveProperty('credential')
  expect(requests.save).not.toHaveBeenCalled()
})

it('compares the updated base after a second conflict without retaining the previous verification snapshot or saving automatically', async () => {
  const staleCard = { name: 'Previous verification snapshot' }
  const revision2Card = { name: 'Revision two service' }
  const revision3Card = { name: 'Revision three service' }
  requests.verify.mockResolvedValueOnce(
    createExternalVerification({
      interface_url: 'https://previous-verification.example.test/interface',
      card: staleCard,
      capabilities: { streaming: false },
    }),
  )
  requests.save.mockRejectedValueOnce(new ORPCError('conflict', { status: 409 }))
  await setup()
  await endpoint().fill('https://my-change.example.test/agent')
  await verify().click()
  await expect
    .element(dialog().getByRole('button', { name: 'Save changes', exact: true }))
    .toBeEnabled()
  advanceConnection(revision2, 'Jamie Lee', {
    interface_url: 'https://revision-two.example.test/interface',
    profile: 'a2a_v2',
    card: revision2Card,
    capabilities: { streaming: true },
  })
  await dialog().getByRole('button', { name: 'Save changes', exact: true }).click()
  await expectComparisonRow('Agent Card', staleCard, revision2Card)
  await expect
    .element(dialog().getByRole('button', { name: 'Keep my edits', exact: true }))
    .toBeEnabled()
  await dialog().getByRole('button', { name: 'Keep my edits', exact: true }).click()
  await token().fill('replacement-for-revision2')
  advanceConnection(revision3, 'Second saver', {
    interface_url: 'https://revision-three.example.test/interface',
    profile: 'a2a_v3',
    card: revision3Card,
    capabilities: { streaming: false, traceability_supported: true },
  })
  requests.verify.mockRejectedValueOnce(new ORPCError('conflict', { status: 409 }))
  await verify().click()
  await expectComparisonRow(
    'Interface URL',
    'https://revision-two.example.test/interface',
    'https://revision-three.example.test/interface',
  )
  await expectComparisonRow('Protocol profile', 'a2a_v2', 'a2a_v3')
  await expectComparisonRow('Agent Card', revision2Card, revision3Card)
  await expectComparisonRow(
    'Capabilities',
    { streaming: true },
    { streaming: false, traceability_supported: true },
  )
  await expect.element(comparison()).not.toMatchTextContent('Previous verification snapshot')
  await expect
    .element(dialog().getByText('Saved by Second saver 2 minutes ago', { exact: true }))
    .toBeVisible()
  await dialog().getByRole('button', { name: 'Keep my edits', exact: true }).click()
  await expect.element(token()).toHaveValue('')
  await token().fill('fresh-replacement-for-revision3')
  await verify().click()
  await expect
    .element(dialog().getByRole('button', { name: 'Save changes', exact: true }))
    .toBeEnabled()
  expect(requests.verify).toHaveBeenCalledTimes(3)
  expect(requests.verify.mock.calls[2]![0].body.expected_connection_revision_id).toBe(revision3)
  expect(requests.verify.mock.calls[2]![0].body.credential).toBe('fresh-replacement-for-revision3')
  expect(requests.save).toHaveBeenCalledTimes(1)
})

it('recovers an older connection response without audit fields without inventing a saver or date', async () => {
  requests.verify.mockRejectedValueOnce(new ORPCError('conflict', { status: 409 }))
  await setup()
  await endpoint().fill('https://my-change.example.test/agent')
  advanceConnection()
  // boundary: an older API/cache response predates the new mandatory audit fields.
  requests.detail.mockResolvedValue({
    ...current,
    connection: Object.fromEntries(
      Object.entries(current.connection).filter(
        ([key]) => key !== 'saved_by' && key !== 'saved_at',
      ),
    ),
  })
  await verify().click()
  await expect.element(dialog().getByText('Saved by —', { exact: true })).toBeVisible()
  await expect
    .element(dialog().getByText(/Original owner|Jamie Lee|Test User/))
    .not.toBeInTheDocument()
  await dialog().getByRole('button', { name: 'Keep my edits', exact: true }).click()
  await expect.element(endpoint()).toHaveValue('https://my-change.example.test/agent')
  await expect
    .element(endpoint())
    .toHaveAccessibleDescription('Latest configuration: https://latest.example.test/agent, by —')
  expect(requests.verify).toHaveBeenCalledTimes(1)
  expect(requests.save).not.toHaveBeenCalled()
})
