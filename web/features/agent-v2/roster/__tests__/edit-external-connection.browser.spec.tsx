import type { ExternalAgentDetailResponse } from '@dify/contracts/api/console/external-agents/types.gen'
import { ORPCError } from '@orpc/client'
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
import { createDeferred } from '@/test/deferred'
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

function freezeCurrentDate() {
  const now = Date.now()
  vi.setSystemTime(now)
  onTestFinished(() => {
    vi.useRealTimers()
  })
  return now
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
  current = createExternalAgentDetail()
  requests.detail.mockReset().mockImplementation(() => current)
  requests.capabilities.mockReset().mockResolvedValue(createExternalAgentCapabilities())
  requests.verify.mockReset().mockResolvedValue(createExternalVerification())
  requests.save.mockReset().mockResolvedValue(createExternalOperation({ kind: 'connection' }))
  requests.references.mockReset().mockResolvedValue(createExternalAgentReferences())
})

it('enables verification only while the connection has edits and disables it again when restored', async () => {
  await setup()
  await expect.element(verify()).toBeDisabled()
  await endpoint().fill('https://my-change.example.test/agent')
  await expect.element(verify()).toBeEnabled()
  await endpoint().fill('https://agents.example.test/contract')
  await expect.element(verify()).toBeDisabled()
  await token().fill('replacement-token')
  await expect.element(verify()).toBeEnabled()
  await token().fill('')
  await expect.element(verify()).toBeDisabled()
  expect(requests.verify).not.toHaveBeenCalled()
  expect(requests.save).not.toHaveBeenCalled()
})

it('shows a fixed verification failure title with the server conflict reason', async () => {
  requests.verify.mockRejectedValueOnce(
    new ORPCError('conflict', {
      status: 409,
      message: 'The connection changed; load its current configuration.',
    }),
  )
  await setup()
  await endpoint().fill('https://my-change.example.test/agent')
  await verify().click()
  await expect
    .element(dialog().getByRole('alert'))
    .toMatchTextContent('Could not verify the connection.')
  await expect
    .element(dialog().getByRole('alert'))
    .toMatchTextContent('The connection changed; load its current configuration.')
  await expect.element(endpoint()).toHaveValue('https://my-change.example.test/agent')
  expect(requests.save).not.toHaveBeenCalled()
})

it.each([
  [
    'an unpunctuated generic server reason',
    () => new ORPCError('bad_request', { status: 400, message: 'Could not verify the connection' }),
  ],
  [
    'a punctuated generic server reason',
    () =>
      new ORPCError('bad_request', { status: 400, message: 'Could not verify the connection.' }),
  ],
])('shows only the fixed verification title when editing with %s', async (_, error) => {
  requests.verify.mockRejectedValueOnce(error())
  await setup()
  await endpoint().fill('https://my-change.example.test/agent')
  await verify().click()
  const alert = dialog().getByRole('alert')
  await expect.element(alert).toHaveTextContent('Could not verify the connection.')
  expect(requests.save).not.toHaveBeenCalled()
})

it('keeps a saved Bearer credential without sending a mask and saves the verified connection revision', async () => {
  requests.verify.mockResolvedValue(
    createExternalVerification({
      warnings: { technical: ['streaming_removed'], business: ['agent_info_changed'] },
      auth_check: 'passed_for_read_endpoint',
    }),
  )
  await setup()
  await expect.element(token()).toHaveValue('')
  await endpoint().fill('https://my-change.example.test/agent')
  await verify().click()
  await expect
    .element(dialog().getByText('What changes if you save', { exact: true }))
    .toBeVisible()
  await expect.element(dialog().getByText('Connection verified', { exact: true })).toBeVisible()
  await expect
    .element(dialog().getByText('Streaming is no longer supported.', { exact: true }))
    .toBeVisible()
  await expect
    .element(
      dialog().getByText(
        'Workflows that require streaming may fail. Review the workflows using this agent before saving.',
        { exact: true },
      ),
    )
    .toBeVisible()
  await expect
    .element(
      dialog().getByText('Service information has changed. Save to apply the updates.', {
        exact: true,
      }),
    )
    .toBeVisible()
  expect(requests.verify).toHaveBeenCalledExactlyOnceWith({
    body: {
      endpoint: 'https://my-change.example.test/agent',
      auth_type: 'bearer',
      credential_action: 'keep',
      agent_id: current.asset.id,
      expected_connection_revision_id: '33333333-3333-4333-8333-333333333333',
    },
  })
  expect(requests.save).not.toHaveBeenCalled()
  await dialog().getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect.element(dialog()).not.toBeInTheDocument()
  expect(requests.save).toHaveBeenCalledExactlyOnceWith({
    params: { agent_id: current.asset.id },
    body: {
      verification_id: createExternalVerification().verification_id,
      expected_revision_id: '33333333-3333-4333-8333-333333333333',
      idempotency_key: expect.any(String),
    },
  })
})

it('keeps verified settings editable, invalidates their proof, and saves the refreshed proof on Enter', async () => {
  const saving = createDeferred<ReturnType<typeof createExternalOperation>>()
  requests.verify
    .mockResolvedValueOnce(createExternalVerification())
    .mockResolvedValueOnce(
      createExternalVerification({ verification_id: '99999999-9999-4999-8999-999999999999' }),
    )
  requests.save.mockReturnValueOnce(saving.promise)
  await setup()
  await endpoint().fill('https://first-change.example.test/agent')
  await token().fill('replacement-token')
  await verify().click()
  await expect.element(dialog().getByText('Connection verified', { exact: true })).toBeVisible()
  await expect.element(endpoint()).toBeEnabled()

  await endpoint().fill('https://second-change.example.test/agent')
  await expect
    .element(dialog().getByText('Connection verified', { exact: true }))
    .not.toBeInTheDocument()
  await expect.element(verify()).toBeEnabled()
  await expect.element(token()).toHaveValue('replacement-token')

  await verify().click()
  await expect.element(dialog().getByText('Connection verified', { exact: true })).toBeVisible()
  await endpoint().click()
  await userEvent.keyboard('{Enter}')
  await expect.element(endpoint()).toBeDisabled()
  await expect.element(token()).toBeDisabled()
  await expect.element(dialog().getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled()
  await expect.element(dialog().getByLabelText('Close', { exact: true })).toBeDisabled()
  saving.resolve(createExternalOperation({ kind: 'connection' }))
  await expect.element(dialog()).not.toBeInTheDocument()
  expect(requests.verify).toHaveBeenLastCalledWith({
    body: {
      endpoint: 'https://second-change.example.test/agent',
      auth_type: 'bearer',
      credential_action: 'replace',
      credential: 'replacement-token',
      agent_id: current.asset.id,
      expected_connection_revision_id: '33333333-3333-4333-8333-333333333333',
    },
  })
  expect(requests.save).toHaveBeenCalledExactlyOnceWith({
    params: { agent_id: current.asset.id },
    body: {
      verification_id: '99999999-9999-4999-8999-999999999999',
      expected_revision_id: '33333333-3333-4333-8333-333333333333',
      idempotency_key: expect.any(String),
    },
  })
})

it('shows a fixed save failure title and keeps the edited draft when the server gives no reason', async () => {
  requests.save.mockRejectedValueOnce(new ORPCError('', { status: 400, message: '' }))
  await setup()
  await endpoint().fill('https://my-change.example.test/agent')
  await verify().click()
  await dialog().getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect
    .element(dialog().getByRole('alert'))
    .toMatchTextContent('Could not save the connection.')
  await expect
    .element(dialog().getByRole('alert'))
    .toMatchTextContent('Your changes have been kept.')
  await expect.element(endpoint()).toHaveValue('https://my-change.example.test/agent')
  await expect.element(verify()).toBeEnabled()
})

it('shows the referenced apps in the verified connection review before saving', async () => {
  requests.references.mockResolvedValue(
    createExternalAgentReferences({
      apps: [
        {
          app_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          name: 'Contract approval',
          mode: 'workflow',
          node_ids: ['review'],
        },
        {
          app_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          name: 'Legal assistant',
          mode: 'advanced-chat',
          node_ids: ['legal'],
        },
        {
          app_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          name: 'Procurement review',
          mode: 'workflow',
          node_ids: ['procurement'],
        },
      ],
    }),
  )
  await setup()
  await endpoint().fill('https://my-change.example.test/agent')
  await verify().click()
  await expect.element(dialog().getByText('3 apps use this agent', { exact: true })).toBeVisible()
  await expect.element(dialog().getByText('Contract approval', { exact: true })).toBeVisible()
  await expect.element(dialog().getByText('Legal assistant', { exact: true })).toBeVisible()
  await expect.element(dialog().getByText('Procurement review', { exact: true })).toBeVisible()
  expect(requests.references).toHaveBeenCalledWith({ params: { agent_id: current.asset.id } })
  expect(requests.save).not.toHaveBeenCalled()
})

it('replaces conflicted edits with the latest configuration and requires another edit before verification', async () => {
  const now = freezeCurrentDate()
  current = createExternalAgentDetail({
    connection: {
      ...current.connection,
      saved_by: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Initial saver' },
      saved_at: new Date(now - 86400000).toISOString(),
    },
  })
  requests.save.mockRejectedValueOnce(new ORPCError('conflict', { status: 409 }))
  await setup()
  await expect.element(endpoint()).toHaveAccessibleDescription('')
  await endpoint().fill('https://my-change.example.test/agent')
  await token().fill('discarded-token')
  await verify().click()
  await expect
    .element(dialog().getByRole('button', { name: 'Save changes', exact: true }))
    .toBeEnabled()
  current = createExternalAgentDetail({
    asset: {
      ...current.asset,
      created_by: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      updated_at: new Date(now - 7200000).toISOString(),
    },
    connection: {
      ...current.connection,
      revision_id: '88888888-8888-4888-8888-888888888888',
      endpoint: 'https://latest.example.test/agent',
      auth_type: 'none',
      has_credential: false,
      verified_at: new Date(now - 30000).toISOString(),
      saved_by: { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'Earlier conflict saver' },
      saved_at: new Date(now - 600000).toISOString(),
    },
  })
  await dialog().getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect
    .element(dialog().getByText('This connection was updated by someone else.', { exact: true }))
    .toBeVisible()
  await expect.element(dialog().getByText('Your changes', { exact: true })).toBeVisible()
  await expect.element(dialog().getByText('Latest configuration', { exact: true })).toBeVisible()
  await expect
    .element(dialog().getByText('https://my-change.example.test/agent', { exact: true }))
    .toBeVisible()
  await expect
    .element(dialog().getByText('https://latest.example.test/agent', { exact: true }))
    .toBeVisible()
  const original = requests.save.mock.calls[0]![0]
  requests.verify.mockResolvedValue(
    createExternalVerification({ verification_id: '99999999-9999-4999-8999-999999999999' }),
  )
  current = {
    ...current,
    connection: {
      ...current.connection,
      revision_id: '77777777-7777-4777-8777-777777777777',
      saved_by: { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', name: ' Jamie Lee ' },
      saved_at: new Date(now - 300000).toISOString(),
    },
  }
  await dialog().getByRole('button', { name: 'Use latest configuration', exact: true }).click()
  await expect.element(endpoint()).toHaveValue('https://latest.example.test/agent')
  await expect.element(endpoint()).toHaveAccessibleDescription('Saved by Jamie Lee 5 minutes ago')
  await expect.element(token()).not.toBeInTheDocument()
  await expect.element(verify()).toBeDisabled()
  expect(requests.verify).toHaveBeenCalledTimes(1)
  expect(requests.save).toHaveBeenCalledTimes(1)
  await endpoint().fill('https://another-change.example.test/agent')
  await verify().click()
  await expect
    .element(dialog().getByRole('button', { name: 'Save changes', exact: true }))
    .toBeEnabled()
  await dialog().getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect.element(dialog()).not.toBeInTheDocument()
  expect(requests.verify).toHaveBeenLastCalledWith({
    body: {
      endpoint: 'https://another-change.example.test/agent',
      auth_type: 'none',
      credential_action: 'remove',
      agent_id: current.asset.id,
      expected_connection_revision_id: '77777777-7777-4777-8777-777777777777',
    },
  })
  expect(requests.save.mock.calls[1]![0].body).toEqual({
    verification_id: '99999999-9999-4999-8999-999999999999',
    expected_revision_id: '77777777-7777-4777-8777-777777777777',
    idempotency_key: expect.any(String),
  })
  expect(requests.save.mock.calls[1]![0].body.idempotency_key).not.toBe(
    original.body.idempotency_key,
  )
})

it('keeps the edited endpoint and authentication after a conflict but reverifies a fresh credential against the latest revision', async () => {
  const now = freezeCurrentDate()
  requests.save.mockRejectedValueOnce(new ORPCError('conflict', { status: 409 }))
  await setup()
  await expect.element(endpoint()).toHaveAccessibleDescription('')
  await endpoint().fill('https://my-change.example.test/agent')
  await token().fill('discarded-token')
  await verify().click()
  await expect
    .element(dialog().getByRole('button', { name: 'Save changes', exact: true }))
    .toBeEnabled()
  current = createExternalAgentDetail({
    asset: {
      ...current.asset,
      created_by: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      updated_at: new Date(now - 7200000).toISOString(),
    },
    connection: {
      ...current.connection,
      revision_id: '88888888-8888-4888-8888-888888888888',
      endpoint: 'https://latest.example.test/agent',
      auth_type: 'none',
      has_credential: false,
      verified_at: new Date(now - 30000).toISOString(),
      saved_by: { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', name: ' Jamie Lee ' },
      saved_at: new Date(now - 300000).toISOString(),
    },
  })
  await dialog().getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect
    .element(
      dialog().getByText('Credentials are not shown. Enter a replacement again if needed.', {
        exact: true,
      }),
    )
    .toBeVisible()
  const original = requests.save.mock.calls[0]![0]
  await dialog().getByRole('button', { name: 'Keep my edits', exact: true }).click()
  await expect.element(endpoint()).toHaveValue('https://my-change.example.test/agent')
  await expect
    .element(endpoint())
    .toHaveAccessibleDescription(
      'Latest configuration: https://latest.example.test/agent, by Jamie Lee',
    )
  await expect.element(token()).toHaveValue('')
  await expect.element(verify()).toBeVisible()
  expect(requests.verify).toHaveBeenCalledTimes(1)
  expect(requests.save).toHaveBeenCalledTimes(1)
  await token().fill('new-replacement-token')
  requests.verify.mockResolvedValue(
    createExternalVerification({ verification_id: '99999999-9999-4999-8999-999999999999' }),
  )
  await verify().click()
  await expect
    .element(dialog().getByRole('button', { name: 'Save changes', exact: true }))
    .toBeEnabled()
  expect(requests.verify).toHaveBeenLastCalledWith({
    body: {
      endpoint: 'https://my-change.example.test/agent',
      auth_type: 'bearer',
      credential_action: 'replace',
      credential: 'new-replacement-token',
      agent_id: current.asset.id,
      expected_connection_revision_id: '88888888-8888-4888-8888-888888888888',
    },
  })
  await dialog().getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect.element(dialog()).not.toBeInTheDocument()
  expect(requests.save.mock.calls[1]![0].body).toEqual({
    verification_id: '99999999-9999-4999-8999-999999999999',
    expected_revision_id: '88888888-8888-4888-8888-888888888888',
    idempotency_key: expect.any(String),
  })
  expect(requests.save.mock.calls[1]![0].body.idempotency_key).not.toBe(
    original.body.idempotency_key,
  )
})

it('uses the latest saved credential when keeping endpoint edits without replaying the discarded replacement', async () => {
  requests.save.mockRejectedValueOnce(new ORPCError('conflict', { status: 409 }))
  await setup()
  await endpoint().fill('https://my-change.example.test/agent')
  await token().fill('discarded-token')
  await verify().click()
  await expect
    .element(dialog().getByRole('button', { name: 'Save changes', exact: true }))
    .toBeEnabled()
  current = createExternalAgentDetail({
    connection: {
      ...current.connection,
      revision_id: '88888888-8888-4888-8888-888888888888',
      endpoint: 'https://latest.example.test/agent',
    },
  })
  await dialog().getByRole('button', { name: 'Save changes', exact: true }).click()
  await dialog().getByRole('button', { name: 'Keep my edits', exact: true }).click()
  await expect.element(endpoint()).toHaveValue('https://my-change.example.test/agent')
  await expect.element(token()).toHaveValue('')
  await expect.element(verify()).toBeEnabled()
  await verify().click()
  await expect
    .element(dialog().getByRole('button', { name: 'Save changes', exact: true }))
    .toBeEnabled()
  expect(requests.verify).toHaveBeenLastCalledWith({
    body: {
      endpoint: 'https://my-change.example.test/agent',
      auth_type: 'bearer',
      credential_action: 'keep',
      agent_id: current.asset.id,
      expected_connection_revision_id: '88888888-8888-4888-8888-888888888888',
    },
  })
  expect(requests.save).toHaveBeenCalledTimes(1)
})

it.each([
  {
    missing: 'a null saver name',
    metadata: (savedAt: string) => ({
      saved_by: { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', name: null },
      saved_at: savedAt,
    }),
    description: 'Saved by — 5 minutes ago',
  },
  {
    missing: 'legacy save metadata',
    metadata: (_savedAt: string) => ({}),
    description: 'Saved by — —',
  },
  {
    missing: 'a valid save timestamp',
    metadata: (_savedAt: string) => ({
      saved_by: { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', name: 'Jamie Lee' },
      saved_at: 'not-a-date',
    }),
    description: 'Saved by Jamie Lee —',
  },
])('uses independent save-metadata fallbacks with $missing', async ({ metadata, description }) => {
  const now = freezeCurrentDate()
  requests.save.mockRejectedValueOnce(new ORPCError('conflict', { status: 409 }))
  await setup()
  await endpoint().fill('https://my-change.example.test/agent')
  await verify().click()
  current = createExternalAgentDetail({
    asset: {
      ...current.asset,
      created_by: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      updated_at: new Date(now - 60000).toISOString(),
    },
    connection: {
      ...current.connection,
      revision_id: '88888888-8888-4888-8888-888888888888',
      endpoint: 'https://latest.example.test/agent',
      verified_at: new Date(now - 120000).toISOString(),
      ...metadata(new Date(now - 300000).toISOString()),
    },
  })
  await dialog().getByRole('button', { name: 'Save changes', exact: true }).click()
  await dialog().getByRole('button', { name: 'Use latest configuration', exact: true }).click()
  await expect.element(endpoint()).toHaveValue('https://latest.example.test/agent')
  await expect.element(endpoint()).toHaveAccessibleDescription(description)
})

it('recovers an unknown connection Save with the original proof, revision and key after reopening', async () => {
  const proof = createExternalVerification()
  requests.verify.mockResolvedValue(proof)
  requests.save.mockRejectedValueOnce(new ORPCError('INTERNAL_SERVER_ERROR', { status: 500 }))
  const { trigger } = await setup()
  await endpoint().fill('https://my-change.example.test/agent')
  await verify().click()
  await dialog().getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect
    .element(dialog().getByRole('button', { name: 'Check save status', exact: true }))
    .toBeVisible()
  const original = requests.save.mock.calls[0]![0]
  await dialog().getByRole('button', { name: 'Close', exact: true }).last().click()
  await expect.element(dialog()).not.toBeInTheDocument()
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse(proof.expires_at) + 1)
  onTestFinished(() => clock.mockRestore())
  await trigger.click()
  await dialog().getByRole('button', { name: 'Check save status', exact: true }).click()
  await expect.element(dialog()).not.toBeInTheDocument()
  expect(requests.save).toHaveBeenCalledTimes(2)
  expect(requests.save.mock.calls[1]![0]).toEqual(original)
  expect(requests.verify).toHaveBeenCalledTimes(1)
})
