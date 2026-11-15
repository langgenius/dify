import type { ExternalAgentVerificationResponse } from '@dify/contracts/api/console/external-agents/types.gen'
import { ORPCError } from '@orpc/client'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import agentRoster from '@/i18n/locales/en-US/agent-roster.json'
import common from '@/i18n/locales/en-US/common.json'
import { createExternalAgentCapabilities } from '@/test/console/external-agents'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { ConnectExternalAgent } from '../components/connect-external-agent'
import { createExternalOperation, createExternalVerification } from './external-connection-fixture'

const requests = vi.hoisted(() => ({
  capabilities: vi.fn(),
  verify: vi.fn(),
  create: vi.fn(),
  push: vi.fn(),
}))
// boundary: restore real English translations for browser interactions.
vi.mock('react-i18next', async (importOriginal) => importOriginal())
// boundary: replace Console transport responses while keeping generated query options real.
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'externalAgents.capabilities.get': requests.capabilities,
      'externalAgents.verify.post': requests.verify,
      'externalAgents.post': requests.create,
    }),
  }
})
// boundary: navigation after confirmed creation belongs to the application router.
vi.mock('@/next/navigation', () => ({ useRouter: () => ({ push: requests.push }) }))

const dialog = () => page.getByRole('dialog', { name: 'Connect external agent', exact: true })
const endpoint = () => dialog().getByRole('textbox', { name: 'A2A endpoint', exact: true })
const verify = () => dialog().getByRole('button', { name: 'Verify connection', exact: true })
const role = () => dialog().getByRole('textbox', { name: /Role/ })
const description = () => dialog().getByRole('textbox', { name: 'Description', exact: true })

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
          <ConnectExternalAgent />
        </div>
      </I18nextProvider>
    </QueryProvider>,
  )
  const trigger = page.getByRole('button', { name: 'Connect external agent', exact: true })
  await expect.element(trigger).toBeEnabled()
  await trigger.click()
  await expect.element(dialog()).toBeVisible()
  return { trigger }
}

async function reachDetails() {
  await endpoint().fill('https://agents.example.test/contract')
  await verify().click()
  await expect.element(description()).toHaveValue('Reviews contracts.')
}

beforeEach(({ onTestFinished }) => {
  onTestFinished(guardUnexpectedFetch())
  requests.capabilities.mockReset().mockResolvedValue(createExternalAgentCapabilities())
  requests.verify.mockReset().mockResolvedValue(createExternalVerification())
  requests.create.mockReset().mockResolvedValue(createExternalOperation())
  requests.push.mockReset()
})

it('verifies None/remove, preserves metadata across Back, and navigates only after a committed Create receipt', async () => {
  await setup()
  await reachDetails()
  expect(requests.verify).toHaveBeenCalledExactlyOnceWith({
    body: {
      endpoint: 'https://agents.example.test/contract',
      auth_type: 'none',
      credential_action: 'remove',
    },
  })
  await expect
    .element(
      dialog().getByText('Connection verified. Authentication was not exercised.', { exact: true }),
    )
    .toBeVisible()
  expect(requests.create).not.toHaveBeenCalled()
  await role().fill('Legal operations')
  await description().fill('Custom description')
  await dialog().getByRole('button', { name: 'Back', exact: true }).click()
  await expect.element(endpoint()).toHaveValue('https://agents.example.test/contract')
  await dialog().getByRole('button', { name: 'Continue', exact: true }).click()
  await expect.element(role()).toHaveValue('Legal operations')
  await expect.element(description()).toHaveValue('Custom description')
  await dialog().getByRole('button', { name: 'Save', exact: true }).click()
  await expect
    .poll(() => requests.push.mock.calls)
    .toEqual([[`/external-agent/${createExternalOperation().resource_id}/overview`]])
  expect(requests.create).toHaveBeenCalledExactlyOnceWith({
    body: {
      verification_id: createExternalVerification().verification_id,
      metadata: {
        name: 'Contract Review Agent',
        role: 'Legal operations',
        description: 'Custom description',
      },
      idempotency_key: expect.any(String),
    },
  })
})

it('validates native endpoint/token fields and invalidates verification when connection inputs change', async () => {
  requests.verify.mockResolvedValueOnce(createExternalVerification()).mockResolvedValueOnce(
    createExternalVerification({
      verification_id: '77777777-7777-4777-8777-777777777777',
      auth_check: 'passed_for_read_endpoint',
    }),
  )
  await setup()
  await endpoint().fill('ftp://agents.example.test')
  await verify().click()
  await expect.element(endpoint()).toBeInvalid()
  expect(requests.verify).not.toHaveBeenCalled()
  await endpoint().fill('https://agents.example.test/contract')
  await dialog().getByRole('combobox', { name: 'Authentication', exact: true }).click()
  await page.getByRole('option', { name: 'Bearer token', exact: true }).click()
  const token = () => dialog().getByLabelText('Token', { exact: true })
  await token().fill('has whitespace')
  await verify().click()
  await expect.element(token()).toBeInvalid()
  expect(requests.verify).not.toHaveBeenCalled()
  await token().fill('first-token')
  await verify().click()
  await expect.element(description()).toBeVisible()
  await role().fill('Discard after changed connection')
  await dialog().getByRole('button', { name: 'Back', exact: true }).click()
  await expect.element(token()).toHaveValue('')
  await endpoint().fill('https://another.example.test/agent')
  await expect
    .element(dialog().getByRole('button', { name: 'Continue', exact: true }))
    .not.toBeInTheDocument()
  await token().fill('second-token')
  await verify().click()
  await expect.element(role()).toHaveValue('')
  await expect
    .element(dialog().getByText('Authentication passed for a read-only endpoint.', { exact: true }))
    .toBeVisible()
  await dialog().getByRole('button', { name: 'Save', exact: true }).click()
  await expect.poll(() => requests.create.mock.calls).toHaveLength(1)
  expect(requests.verify).toHaveBeenLastCalledWith({
    body: {
      endpoint: 'https://another.example.test/agent',
      auth_type: 'bearer',
      credential_action: 'replace',
      credential: 'second-token',
    },
  })
  expect(requests.create.mock.calls[0]![0].body.verification_id).toBe(
    '77777777-7777-4777-8777-777777777777',
  )
})

it('locks a pending verification and displays a generic HTTP400 without inventing a failure category', async () => {
  const pending = createDeferred<ExternalAgentVerificationResponse>()
  requests.verify.mockImplementationOnce(() => pending.promise)
  await setup()
  await endpoint().fill('https://agents.example.test/contract')
  await verify().click()
  await expect.element(endpoint()).toBeDisabled()
  await expect.element(dialog().getByRole('button', { name: 'Close', exact: true })).toBeDisabled()
  await userEvent.keyboard('{Escape}')
  await expect.element(dialog()).toBeVisible()
  pending.reject(
    new ORPCError('bad_request', { status: 400, message: 'Could not verify this connection.' }),
  )
  await expect
    .element(dialog().getByRole('alert'))
    .toMatchTextContent('Could not verify this connection.')
  await expect.element(endpoint()).toHaveValue('https://agents.example.test/contract')
  await expect
    .element(dialog().getByText('skills[0].description is required.', { exact: true }))
    .not.toBeInTheDocument()
  expect(requests.create).not.toHaveBeenCalled()
  await verify().click()
  await expect.element(description()).toBeVisible()
})

it('rejects expired verification before any Create request', async () => {
  const proof = createExternalVerification()
  requests.verify.mockResolvedValue(proof)
  await setup()
  await reachDetails()
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse(proof.expires_at) + 1)
  onTestFinished(() => clock.mockRestore())
  await dialog().getByRole('button', { name: 'Save', exact: true }).click()
  await expect
    .element(dialog().getByRole('alert'))
    .toMatchTextContent('Verification expired. Verify the connection again.')
  expect(requests.create).not.toHaveBeenCalled()
  await dialog().getByRole('button', { name: 'Back', exact: true }).click()
  await expect.element(verify()).toBeVisible()
})

it('recovers an unknown Create result with exactly the same body/key even after evidence expires', async () => {
  const proof = createExternalVerification()
  requests.verify.mockResolvedValue(proof)
  requests.create.mockRejectedValueOnce(new ORPCError('INTERNAL_SERVER_ERROR', { status: 500 }))
  const { trigger } = await setup()
  await reachDetails()
  await role().fill('Recovery role')
  await dialog().getByRole('button', { name: 'Save', exact: true }).click()
  await expect
    .element(dialog().getByRole('button', { name: 'Check save status', exact: true }))
    .toBeVisible()
  const original = requests.create.mock.calls[0]![0]
  await expect.element(role()).toBeDisabled()
  await dialog().getByRole('button', { name: 'Close', exact: true }).click()
  await expect.element(dialog()).not.toBeInTheDocument()
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse(proof.expires_at) + 1)
  onTestFinished(() => clock.mockRestore())
  await trigger.click()
  await dialog().getByRole('button', { name: 'Check save status', exact: true }).click()
  await expect.poll(() => requests.push.mock.calls).toHaveLength(1)
  expect(requests.create).toHaveBeenCalledTimes(2)
  expect(requests.create.mock.calls[1]![0]).toEqual(original)
  expect(requests.verify).toHaveBeenCalledTimes(1)
})
