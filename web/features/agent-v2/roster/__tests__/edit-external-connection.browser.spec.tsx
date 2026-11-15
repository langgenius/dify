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
import {
  createExternalAgentCapabilities,
  createExternalAgentDetail,
} from '@/test/console/external-agents'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { createExternalOperation, createExternalVerification } from './external-connection-fixture'

const requests = vi.hoisted(() => ({
  detail: vi.fn(),
  capabilities: vi.fn(),
  verify: vi.fn(),
  save: vi.fn(),
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
    }),
  }
})

let current: ExternalAgentDetailResponse
const dialog = () => page.getByRole('dialog', { name: 'Edit connection', exact: true })
const endpoint = () => dialog().getByRole('textbox', { name: 'A2A endpoint', exact: true })
const verify = () => dialog().getByRole('button', { name: 'Verify connection', exact: true })

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
})

it('keeps a saved Bearer credential without sending a mask and saves the verified connection revision', async () => {
  requests.verify.mockResolvedValue(
    createExternalVerification({
      warnings: { technical: ['streaming_removed'], business: ['skills_changed'] },
      auth_check: 'passed_for_read_endpoint',
    }),
  )
  await setup()
  await expect.element(dialog().getByLabelText('Token', { exact: true })).toHaveValue('')
  await verify().click()
  await expect
    .element(dialog().getByText('Review connection changes', { exact: true }))
    .toBeVisible()
  await expect
    .element(dialog().getByText('Streaming is no longer supported.', { exact: true }))
    .toBeVisible()
  await expect
    .element(dialog().getByText('Agent skills have changed.', { exact: true }))
    .toBeVisible()
  expect(requests.verify).toHaveBeenCalledExactlyOnceWith({
    body: {
      endpoint: 'https://agents.example.test/contract',
      auth_type: 'bearer',
      credential_action: 'keep',
      agent_id: current.asset.id,
      expected_connection_revision_id: '33333333-3333-4333-8333-333333333333',
    },
  })
  expect(requests.save).not.toHaveBeenCalled()
  await dialog().getByRole('button', { name: 'Save', exact: true }).click()
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

it('discards conflicted evidence and requires Verify against the explicitly reloaded revision', async () => {
  requests.save.mockRejectedValueOnce(new ORPCError('conflict', { status: 409 }))
  await setup()
  await endpoint().fill('https://my-change.example.test/agent')
  await verify().click()
  await expect.element(dialog().getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
  await dialog().getByRole('button', { name: 'Save', exact: true }).click()
  await expect
    .element(
      dialog().getByText(
        'This configuration changed. Load the latest version before saving again.',
        { exact: true },
      ),
    )
    .toBeVisible()
  await expect
    .element(dialog().getByText('https://my-change.example.test/agent', { exact: true }))
    .toBeVisible()
  await expect.element(dialog().getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
  expect(requests.save).toHaveBeenCalledTimes(1)
  const original = requests.save.mock.calls[0]![0]
  current = createExternalAgentDetail({
    connection: {
      ...current.connection,
      revision_id: '88888888-8888-4888-8888-888888888888',
      endpoint: 'https://latest.example.test/agent',
      auth_type: 'none',
      has_credential: false,
    },
  })
  requests.verify.mockResolvedValue(
    createExternalVerification({ verification_id: '99999999-9999-4999-8999-999999999999' }),
  )
  await dialog().getByRole('button', { name: 'Load latest configuration', exact: true }).click()
  await expect.element(endpoint()).toHaveValue('https://latest.example.test/agent')
  await expect.element(verify()).toBeVisible()
  await verify().click()
  await expect.element(dialog().getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
  await dialog().getByRole('button', { name: 'Save', exact: true }).click()
  await expect.element(dialog()).not.toBeInTheDocument()
  expect(requests.verify).toHaveBeenLastCalledWith({
    body: {
      endpoint: 'https://latest.example.test/agent',
      auth_type: 'none',
      credential_action: 'remove',
      agent_id: current.asset.id,
      expected_connection_revision_id: '88888888-8888-4888-8888-888888888888',
    },
  })
  expect(requests.save.mock.calls[1]![0].body).toEqual({
    verification_id: '99999999-9999-4999-8999-999999999999',
    expected_revision_id: '88888888-8888-4888-8888-888888888888',
    idempotency_key: expect.any(String),
  })
  expect(requests.save.mock.calls[1]![0].body.idempotency_key).not.toBe(
    original.body.idempotency_key,
  )
})

it('recovers an unknown connection Save with the original proof, revision and key after reopening', async () => {
  const proof = createExternalVerification()
  requests.verify.mockResolvedValue(proof)
  requests.save.mockRejectedValueOnce(new ORPCError('INTERNAL_SERVER_ERROR', { status: 500 }))
  const { trigger } = await setup()
  await verify().click()
  await dialog().getByRole('button', { name: 'Save', exact: true }).click()
  await expect
    .element(dialog().getByRole('button', { name: 'Check save status', exact: true }))
    .toBeVisible()
  const original = requests.save.mock.calls[0]![0]
  await dialog().getByRole('button', { name: 'Close', exact: true }).click()
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
