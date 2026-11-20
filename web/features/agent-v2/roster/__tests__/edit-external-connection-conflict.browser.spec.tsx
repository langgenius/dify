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

function advanceConnection(revision = revision2, name: string | null = 'Jamie Lee') {
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
    },
  })
}

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
      await expect.element(token()).not.toBeInTheDocument()
      await expect.element(verify()).toBeDisabled()
      await endpoint().fill('https://my-fresh-edit.example.test/agent')
    } else {
      await expect.element(endpoint()).toHaveValue('https://my-change.example.test/agent')
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

it('blocks recovery when the latest read fails and retries without saving or revealing credentials', async () => {
  requests.verify.mockRejectedValueOnce(new ORPCError('conflict', { status: 409 }))
  await setup()
  await endpoint().fill('https://my-change.example.test/agent')
  await token().fill('discarded-token')
  advanceConnection()
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
  await expect
    .element(dialog().getByText('https://latest.example.test/agent', { exact: true }))
    .toBeVisible()
  await dialog().getByRole('button', { name: 'Keep my edits', exact: true }).click()
  await expect.element(token()).toHaveValue('')
  expect(requests.verify).toHaveBeenCalledTimes(1)
  expect(requests.save).not.toHaveBeenCalled()
})

it('reloads a second Verify conflict and never saves automatically from a stale proof', async () => {
  requests.verify.mockRejectedValueOnce(new ORPCError('conflict', { status: 409 }))
  await setup()
  await endpoint().fill('https://my-change.example.test/agent')
  advanceConnection()
  await verify().click()
  await expect
    .element(dialog().getByRole('button', { name: 'Keep my edits', exact: true }))
    .toBeEnabled()
  await dialog().getByRole('button', { name: 'Keep my edits', exact: true }).click()
  await token().fill('replacement-for-revision2')
  advanceConnection(revision3, 'Second saver')
  requests.verify.mockRejectedValueOnce(new ORPCError('conflict', { status: 409 }))
  await verify().click()
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
  expect(requests.save).not.toHaveBeenCalled()
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
  await expect.element(dialog().getByText(/Latest configuration:.*Saved by —/)).toBeVisible()
  expect(requests.verify).toHaveBeenCalledTimes(1)
  expect(requests.save).not.toHaveBeenCalled()
})
