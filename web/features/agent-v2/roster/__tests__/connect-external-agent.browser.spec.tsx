import type {
  ExternalConnectionSettings,
  ExternalConnectionVerificationResult,
} from '../components/external-connection-verification'
import { createInstance } from 'i18next'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { I18nextProvider } from 'react-i18next'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import agentRoster from '@/i18n/locales/en-US/agent-roster.json'
import common from '@/i18n/locales/en-US/common.json'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { ConnectExternalAgent } from '../components/connect-external-agent'
import { ExternalRoster } from '../external-roster'
import { externalConnectionPreview } from '../external-roster-preview'

// boundary: restore real translations so this fixture's I18nextProvider supplies rendered labels.
vi.mock('react-i18next', async (importOriginal) => importOriginal())

const defaultDescription =
  'Reviews contract clauses against your company’s policies, identifies risks, and suggests safer wording.'
const dialog = () => page.getByRole('dialog', { name: 'Connect external agent', exact: true })
const endpoint = () => dialog().getByRole('textbox', { name: 'A2A endpoint', exact: true })
const verify = () => dialog().getByRole('button', { name: 'Verify connection', exact: true })
const continueToDetails = () => dialog().getByRole('button', { name: 'Continue', exact: true })
const role = () => dialog().getByRole('textbox', { name: /Role/ })
const description = () => dialog().getByRole('textbox', { name: 'Description', exact: true })

type VerifyConnection = (
  settings: ExternalConnectionSettings,
) => Promise<ExternalConnectionVerificationResult>

async function setup({
  roster = false,
  verifyConnection,
}: {
  roster?: boolean
  verifyConnection?: VerifyConnection
} = {}) {
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    resources: { 'en-US': { agentRoster, common } },
    keySeparator: false,
    interpolation: { escapeValue: false },
  })
  const onConnect = vi.fn()
  const { wrapper: QueryProvider, queryClient } = createConsoleQueryWrapper({
    currentWorkspace: { role: 'owner' },
  })
  onTestFinished(() => queryClient.clear())
  await render(
    <QueryProvider>
      <NuqsTestingAdapter>
        <I18nextProvider i18n={i18n}>
          {roster ? (
            <ExternalRoster initialAgents={[]} />
          ) : (
            <ConnectExternalAgent onConnect={onConnect} verifyConnection={verifyConnection} />
          )}
        </I18nextProvider>
      </NuqsTestingAdapter>
    </QueryProvider>,
  )
  await page.getByRole('button', { name: 'Connect external agent', exact: true }).click()
  await expect.element(dialog()).toBeVisible()
  return { onConnect }
}

async function reachDetails() {
  await endpoint().fill('https://agents.example.com/a2a')
  await verify().click()
  await expect.element(description()).toHaveValue(defaultDescription)
}

beforeEach(({ onTestFinished }) => {
  onTestFinished(guardUnexpectedFetch())
})

it('validates connection settings and preserves the detail draft when returning without connection changes', async () => {
  const verifyConnection = vi.fn<VerifyConnection>().mockResolvedValue({
    status: 'verified',
    agent: externalConnectionPreview,
  })
  const { onConnect } = await setup({ verifyConnection })
  await expect.element(verify()).toBeEnabled()
  await endpoint().fill('d')
  await verify().click()
  await expect.element(endpoint()).toBeInvalid()
  await expect
    .poll(() =>
      dialog().getByText('Enter a valid HTTP or HTTPS endpoint.', { exact: true }).elements(),
    )
    .toHaveLength(1)
  await endpoint().fill('')
  await verify().click()
  await expect.element(endpoint()).toBeInvalid()
  await expect
    .poll(() => dialog().getByText('Enter an A2A endpoint.', { exact: true }).elements())
    .toHaveLength(1)
  await endpoint().fill('ftp://agents.example.com/a2a')
  await verify().click()
  await expect.element(endpoint()).toBeInvalid()
  await expect
    .poll(() =>
      dialog().getByText('Enter a valid HTTP or HTTPS endpoint.', { exact: true }).elements(),
    )
    .toHaveLength(1)
  await expect.element(description()).not.toBeInTheDocument()

  await endpoint().fill('https://agents.example.com/a2a')
  await dialog().getByRole('combobox', { name: 'Authentication', exact: true }).click()
  await page.getByRole('option', { name: 'Bearer token', exact: true }).click()
  const token = () => dialog().getByLabelText('Token', { exact: true })
  await verify().click()
  await expect.element(token()).toBeInvalid()
  await expect
    .poll(() => dialog().getByText('Enter a bearer token.', { exact: true }).elements())
    .toHaveLength(1)
  await token().fill('   ')
  await verify().click()
  await expect.element(token()).toBeInvalid()
  await expect
    .poll(() => dialog().getByText('Enter a bearer token.', { exact: true }).elements())
    .toHaveLength(1)
  await expect.element(description()).not.toBeInTheDocument()
  expect(verifyConnection).not.toHaveBeenCalled()

  await token().fill('test-token')
  await verify().click()
  await expect.element(description()).toHaveValue(defaultDescription)
  await expect.element(dialog().getByText('Contract Review Agent', { exact: true })).toBeVisible()
  await expect.element(dialog().getByText('A2A 1.0', { exact: true })).toBeVisible()
  await expect.element(dialog().getByText('Connection verified', { exact: true })).toBeVisible()
  await expect.element(dialog().getByText('Contract review', { exact: true })).toBeVisible()
  await expect.element(dialog().getByText('Clause rewrite', { exact: true })).toBeVisible()

  await dialog().getByRole('button', { name: 'Description', exact: true }).click()
  const hint = page.getByRole('dialog', { name: 'Description', exact: true })
  await expect
    .element(hint.getByText('Prefilled from the Agent Card. Changes are saved only in Dify.'))
    .toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(hint).not.toBeInTheDocument()

  await role().fill(' Legal operations ')
  await description().fill(' Reviews agreements for our procurement team. ')
  await dialog().getByRole('button', { name: 'Back', exact: true }).click()
  await expect.element(endpoint()).toHaveValue('https://agents.example.com/a2a')
  await expect.element(token()).toHaveValue('test-token')
  await expect.element(dialog().getByText('Verified', { exact: true })).toBeVisible()
  await expect.element(token()).toHaveAccessibleDescription('Verified')
  await continueToDetails().click()
  await expect.element(role()).toHaveValue(' Legal operations ')
  await expect.element(description()).toHaveValue(' Reviews agreements for our procurement team. ')
  await dialog().getByRole('button', { name: 'Save', exact: true }).click()
  await expect.element(dialog()).not.toBeInTheDocument()
  expect(onConnect).toHaveBeenCalledExactlyOnceWith({
    name: 'Contract Review Agent',
    role: 'Legal operations',
    description: 'Reviews agreements for our procurement team.',
  })
  expect(verifyConnection).toHaveBeenCalledExactlyOnceWith({
    endpoint: 'https://agents.example.com/a2a',
    authentication: 'bearer',
    token: 'test-token',
  })
})

it('resets Agent Card defaults after changing the connection and adds the saved agent to the local roster', async () => {
  await setup({ roster: true })
  await dialog().getByRole('combobox', { name: 'Authentication', exact: true }).click()
  await page.getByRole('option', { name: 'Bearer token', exact: true }).click()
  const token = dialog().getByLabelText('Token', { exact: true })
  await token.fill('test-token')
  await reachDetails()
  await role().fill('Discarded role')
  await description().fill('Discarded description')
  await dialog().getByRole('button', { name: 'Back', exact: true }).click()
  await expect.element(continueToDetails()).toBeVisible()
  await expect.element(token).toHaveAccessibleDescription('Verified')
  await endpoint().fill('https://another-agent.example.com/a2a')
  await expect.element(dialog().getByText('Verified', { exact: true })).not.toBeInTheDocument()
  await expect.element(token).not.toHaveAccessibleDescription('Verified')
  await expect.element(continueToDetails()).not.toBeInTheDocument()
  await verify().click()
  await expect.element(role()).toHaveValue('')
  await expect.element(description()).toHaveValue(defaultDescription)
  await role().fill('Legal operations')
  await dialog().getByRole('button', { name: 'Save', exact: true }).click()
  await expect.element(dialog()).not.toBeInTheDocument()
  const agent = page.getByRole('listitem', { name: 'Contract Review Agent', exact: true })
  await expect.element(agent.getByText('Legal operations', { exact: true })).toBeVisible()
  await expect.element(agent.getByText(defaultDescription, { exact: true })).toBeVisible()
  await expect.element(page.getByRole('radio', { name: 'Enabled 1', exact: true })).toBeVisible()
})

it('discards the connection and detail drafts when the dialog is closed and reopened', async () => {
  const { onConnect } = await setup()
  await reachDetails()
  await role().fill('Unsaved role')
  await description().fill('Unsaved description')
  await dialog().getByRole('button', { name: 'Close', exact: true }).click()
  await expect.element(dialog()).not.toBeInTheDocument()
  await page.getByRole('button', { name: 'Connect external agent', exact: true }).click()
  await expect.element(endpoint()).toHaveValue('')
  await expect
    .element(dialog().getByRole('combobox', { name: 'Authentication', exact: true }))
    .toHaveTextContent('None')
  await reachDetails()
  await expect.element(role()).toHaveValue('')
  await expect.element(description()).toHaveValue(defaultDescription)
  expect(onConnect).not.toHaveBeenCalled()
})

it('keeps a pending verification open and permits a corrected token to recover from an authentication failure', async () => {
  const pending = createDeferred<ExternalConnectionVerificationResult>()
  const verifyConnection = vi
    .fn<VerifyConnection>()
    .mockImplementationOnce(() => pending.promise)
    .mockResolvedValue({ status: 'verified', agent: externalConnectionPreview })
  const { onConnect } = await setup({ verifyConnection })
  await endpoint().fill('https://agents.example.com/a2a')
  await dialog().getByRole('combobox', { name: 'Authentication', exact: true }).click()
  await page.getByRole('option', { name: 'Bearer token', exact: true }).click()
  const token = () => dialog().getByLabelText('Token', { exact: true })
  await token().fill('invalid-token')
  await verify().click()

  try {
    await expect.element(endpoint()).toBeDisabled()
    await expect.element(token()).toBeDisabled()
    await expect
      .element(dialog().getByRole('combobox', { name: 'Authentication', exact: true }))
      .toBeDisabled()
    await expect
      .element(dialog().getByRole('button', { name: 'Verifying…', exact: true }))
      .toBeDisabled()
    await expect
      .element(dialog().getByRole('button', { name: 'Cancel', exact: true }))
      .toBeDisabled()
    await expect
      .element(dialog().getByRole('button', { name: 'Close', exact: true }))
      .toBeDisabled()
    await userEvent.keyboard('{Escape}')
    await expect.element(dialog()).toBeVisible()

    pending.resolve({ status: 'failed', reason: 'authentication' })
    await expect.element(dialog().getByRole('alert')).toHaveTextContent('Authentication failed.')
    await expect.element(token()).toBeEnabled()
    await expect.element(token()).toHaveValue('invalid-token')
    await token().fill('corrected-token')
    await expect.element(dialog().getByRole('alert')).not.toBeInTheDocument()
    await verify().click()
    await expect.element(description()).toHaveValue(defaultDescription)
    expect(verifyConnection).toHaveBeenCalledTimes(2)
    expect(verifyConnection).toHaveBeenLastCalledWith({
      endpoint: 'https://agents.example.com/a2a',
      authentication: 'bearer',
      token: 'corrected-token',
    })
    expect(onConnect).not.toHaveBeenCalled()
  } finally {
    pending.resolve({ status: 'failed', reason: 'unknown' })
  }
})

it.each([
  { reason: 'unreachable', message: 'Could not reach the agent.' },
  { reason: 'authentication', message: 'Authentication failed.' },
  {
    reason: 'unsupported',
    message: 'This endpoint does not provide a supported A2A connection.',
  },
  { reason: 'invalid-agent-card', message: 'Could not verify the Agent Card.' },
  { reason: 'unknown', message: 'Could not verify the connection.' },
] as const)(
  'explains a $reason verification failure while preserving the connection draft',
  async ({ reason, message }) => {
    const verifyConnection = vi.fn<VerifyConnection>()
    if (reason === 'unknown')
      verifyConnection.mockRejectedValue(new Error('Unexpected verifier error'))
    else verifyConnection.mockResolvedValue({ status: 'failed', reason })
    const { onConnect } = await setup({ verifyConnection })
    await endpoint().fill('https://agents.example.com/a2a')
    await verify().click()
    const alert = dialog().getByRole('alert')
    await expect.element(alert.getByText(message, { exact: true })).toBeVisible()
    if (reason === 'invalid-agent-card') {
      await expect
        .element(alert.getByText('skills[0].description is required.', { exact: true }))
        .toBeVisible()
    }
    await expect.element(endpoint()).toHaveValue('https://agents.example.com/a2a')
    await expect.element(verify()).toBeEnabled()
    await expect.element(description()).not.toBeInTheDocument()
    expect(onConnect).not.toHaveBeenCalled()
  },
)
