import type {
  InstalledAppParametersResponse,
  InstalledConnectionPreflightPayload,
} from '@dify/contracts/api/console/installed-apps/types.gen'
import { TooltipProvider } from '@langgenius/dify-ui/tooltip'
import { QueryClientProvider } from '@tanstack/react-query'
import { render } from 'vitest-browser-react'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { TEST_APP_ID } from '@/test/console/ids'
import { createDeferred } from '@/test/deferred'
import { setupFakeApi } from '@/test/fake-api'
import { createTestQueryClient } from '@/test/query-client'
import { InstalledConnectionSetup } from '..'
import { InstalledAppConnectionsProvider } from '../provider'
import { useInstalledAppConnections } from '../use-installed-app-connections'

const revisionOne = '00000000-0000-4000-8000-000000000011'
const workspaceKey = '00000000-0000-4000-8000-000000000021'
const invisibleKey = '00000000-0000-4000-8000-000000000023'
const conversationA = '00000000-0000-4000-8000-000000000031'

const mocks = vi.hoisted(() => ({
  parameters: vi.fn(),
  configuration: vi.fn(),
  list: vi.fn(),
  save: vi.fn(),
  preflight: vi.fn(),
  start: vi.fn(),
  run: vi.fn(),
  create: vi.fn(),
  creationEnabled: false,
  oauthEnabled: false,
}))

setupFakeApi({
  console: {
    installedApps: {
      byInstalledAppId: {
        parameters: { get: (input) => mocks.parameters(input) },
        connections: {
          get: (input) => mocks.list(input),
          configuration: {
            get: (input) => mocks.configuration(input),
            put: (input) => mocks.save(input),
          },
          preflight: { post: (input) => mocks.preflight(input) },
        },
      },
    },
    workspaces: {
      current: {
        tools: { builtin: { get: () => [] } },
        toolProvider: {
          builtin: {
            byProvider: {
              credential: {
                schema: {
                  byCredentialType: {
                    get: () =>
                      mocks.creationEnabled
                        ? [
                            {
                              name: 'api_key',
                              label: { en_US: 'API Key' },
                              type: 'secret-input',
                              required: true,
                            },
                          ]
                        : [],
                  },
                },
              },
              add: { post: (input) => mocks.create(input) },
            },
          },
        },
      },
    },
  },
})

// boundary: workspace credential permissions are outside the installed-app connection workflow.
vi.mock('@/hooks/use-credential-permissions', () => ({
  useCredentialPermissions: () => ({
    canUseCredential: true,
    canCreateCredential: mocks.creationEnabled,
    canManageCredential: mocks.creationEnabled,
  }),
}))

// boundary: supply provider authorization data without starting an external authentication flow.
vi.mock('@/app/components/plugins/plugin-auth/hooks/use-plugin-auth', () => ({
  usePluginAuth: () => ({
    isAuthorized: true,
    canOAuth: false,
    canApiKey: mocks.creationEnabled,
    isLoading: false,
    notAllowCustomCredential: !mocks.creationEnabled,
    invalidPluginCredentialInfo: vi.fn(),
    credentials: [
      {
        id: workspaceKey,
        provider: 'langgenius/github/github',
        name: 'Workspace key',
        credential_type: mocks.oauthEnabled ? 'oauth2' : 'api-key',
        is_default: false,
      },
      {
        id: invisibleKey,
        provider: 'langgenius/github/github',
        name: 'Not permitted by installed app',
        credential_type: 'api-key',
        is_default: false,
      },
    ],
  }),
}))

const requirement = {
  node_id: 'tool-node',
  node_ids: ['tool-node'],
  provider: 'langgenius/github/github',
  provider_label: 'GitHub',
  verified: false,
  title: 'Search repositories',
  purpose: 'Find repositories',
  icon: '',
  icon_dark: null,
  plugin_unique_identifier: 'langgenius/github',
  allowed_credential_types: ['api-key' as const],
}
const credential = {
  id: workspaceKey,
  provider: requirement.provider,
  name: 'Workspace key',
  credential_type: 'api-key' as const,
  credential_status: null,
  account_label: null,
  created_at: 1,
  updated_at: 1,
  expires_at: null,
  last_active_at: null,
}
const parameters: InstalledAppParametersResponse = {
  annotation_reply: {},
  connection_requirements: [requirement],
  connection_revision: revisionOne,
  requires_end_user_connections: true,
  file_upload: {},
  more_like_this: {},
  retriever_resource: {},
  sensitive_word_avoidance: {},
  speech_to_text: {},
  suggested_questions: [],
  suggested_questions_after_answer: {},
  text_to_speech: {},
  user_input_form: [],
  system_parameters: {
    audio_file_size_limit: 10,
    file_size_limit: 10,
    image_file_size_limit: 10,
    video_file_size_limit: 10,
    workflow_file_upload_limit: 10,
  },
}

function RunControl() {
  const state = useInstalledAppConnections()
  return (
    <button disabled={!state.canRun} onClick={() => mocks.run(state.runConfiguration)}>
      Run
    </button>
  )
}

function App({ conversationId }: { conversationId?: string }) {
  const queryClient = createTestQueryClient()
  seedAccountProfileQuery(queryClient)
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <InstalledAppConnectionsProvider
          installedAppId={TEST_APP_ID}
          conversationId={conversationId}
        >
          <InstalledConnectionSetup onStart={mocks.start} />
          <RunControl />
        </InstalledAppConnectionsProvider>
      </TooltipProvider>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  mocks.creationEnabled = false
  mocks.oauthEnabled = false
  mocks.create.mockReset().mockResolvedValue({ result: 'success', id: credential.id })
  mocks.parameters.mockReset().mockResolvedValue(parameters)
  mocks.configuration.mockReset().mockResolvedValue({
    connections: { 'tool-node': null },
    reauthorization_required: false,
  })
  mocks.list
    .mockReset()
    .mockResolvedValue({ data: [credential], has_more: false, next_cursor: null })
  mocks.save.mockReset().mockResolvedValue({
    connections: { 'tool-node': credential },
    reauthorization_required: false,
  })
  mocks.preflight
    .mockReset()
    .mockImplementation(({ body }: { body: InstalledConnectionPreflightPayload }) =>
      Promise.resolve({
        connection_revision: body.connection_revision,
        ready: !!body.connections['tool-node'],
        connections: [
          {
            node_id: 'tool-node',
            connection_id: body.connections['tool-node'],
            status: body.connections['tool-node'] ? 'connected' : 'disconnected',
            check: null,
          },
        ],
      }),
    )
  mocks.start.mockReset()
  mocks.run.mockReset()
})

it('does not block an installed app that needs no connections', async () => {
  mocks.parameters.mockResolvedValue({
    ...parameters,
    connection_requirements: [],
    connection_revision: null,
    requires_end_user_connections: false,
  })
  const screen = await render(<App />)
  await expect.element(screen.getByRole('button', { name: 'Run' })).toBeEnabled()
  expect(mocks.configuration).not.toHaveBeenCalled()
  expect(mocks.list).not.toHaveBeenCalled()
  expect(mocks.preflight).not.toHaveBeenCalled()
})

it.each([true, false])(
  'shows plugin verification from installed-app requirements when verified=%s',
  async (verified) => {
    mocks.parameters.mockResolvedValue({
      ...parameters,
      connection_requirements: [{ ...requirement, verified }],
    })
    const screen = await render(<App />)
    const row = screen.getByRole('listitem', { name: 'GitHub', exact: true })
    await expect.element(row).toBeVisible()
    const badge = row.getByText('plugin.marketplace.verifiedTip', { exact: true })
    if (verified) await expect.element(badge).toBeInTheDocument()
    else await expect.element(badge).not.toBeInTheDocument()
    await expect
      .element(row.getByRole('button', { name: /share.connections.setup.selectConnection/ }))
      .toBeEnabled()
  },
)

it('saves a workspace selection for the current conversation and waits for fresh preflight before running', async () => {
  const check = createDeferred<{
    connection_revision: string
    ready: boolean
    connections: { node_id: string; connection_id: string; status: 'connected'; check: null }[]
  }>()
  const screen = await render(<App conversationId={conversationA} />)
  const start = screen.getByRole('button', { name: 'share.connections.setup.startUsingApp' })
  await expect.element(start).toBeDisabled()
  const picker = screen.getByRole('button', { name: /share.connections.setup.selectConnection/ })
  await expect.element(picker).toBeEnabled()
  await picker.click()
  await expect
    .element(screen.getByRole('button', { name: /Not permitted by installed app/ }))
    .not.toBeInTheDocument()
  mocks.preflight.mockReturnValueOnce(check.promise)
  await screen.getByRole('button', { name: /Workspace key/ }).click()
  await expect.poll(() => mocks.save.mock.calls.length).toBe(1)
  expect(mocks.save).toHaveBeenCalledWith({
    params: { installed_app_id: TEST_APP_ID },
    body: {
      connection_revision: revisionOne,
      connections: { 'tool-node': workspaceKey },
      conversation_id: conversationA,
    },
  })
  await expect.element(start).toBeDisabled()
  await expect.element(screen.getByRole('button', { name: 'Run' })).toBeDisabled()
  await expect.element(screen.getByText('common.loading', { exact: true })).not.toBeInTheDocument()
  expect(mocks.start).not.toHaveBeenCalled()
  check.resolve({
    connection_revision: revisionOne,
    ready: true,
    connections: [
      { node_id: 'tool-node', connection_id: workspaceKey, status: 'connected', check: null },
    ],
  })
  await expect.element(start).toBeEnabled()
  await screen.getByRole('button', { name: 'Run' }).click()
  expect(mocks.run).toHaveBeenCalledWith({
    connection_revision: revisionOne,
    connections: { 'tool-node': workspaceKey },
    conversation_id: conversationA,
  })
})

it('keeps running disabled when a saved workspace credential fails preflight', async () => {
  mocks.configuration.mockResolvedValue({
    connections: { 'tool-node': credential },
    reauthorization_required: false,
  })
  mocks.preflight.mockResolvedValue({
    connection_revision: revisionOne,
    ready: false,
    connections: [
      { node_id: 'tool-node', connection_id: credential.id, status: 'invalid', check: null },
    ],
  })
  const screen = await render(<App />)
  await expect
    .element(screen.getByRole('status'))
    .toHaveTextContent('share.connections.apiKeys.warning')
  await expect.element(screen.getByRole('button', { name: 'Run' })).toBeDisabled()
  await expect
    .element(screen.getByRole('button', { name: 'share.connections.setup.startUsingApp' }))
    .toBeDisabled()
})

it('warns when the selected connection cannot be checked instead of treating its null status as healthy', async () => {
  mocks.configuration.mockResolvedValue({
    connections: { 'tool-node': credential },
    reauthorization_required: false,
  })
  mocks.preflight.mockResolvedValue({
    connection_revision: revisionOne,
    ready: false,
    connections: [
      { node_id: 'tool-node', connection_id: credential.id, status: null, check: null },
    ],
  })
  const screen = await render(<App />)
  await expect.element(screen.getByRole('status')).toHaveTextContent('share.connections.invalid')
  await expect.element(screen.getByRole('button', { name: /Workspace key/ })).toBeEnabled()
  await expect.element(screen.getByRole('button', { name: 'Run' })).toBeDisabled()
  await expect
    .element(screen.getByRole('button', { name: 'share.connections.setup.startUsingApp' }))
    .toBeDisabled()
})

it('explains when a saved OAuth account has expired and lets the user choose another connection', async () => {
  mocks.oauthEnabled = true
  const oauthCredential = { ...credential, credential_type: 'oauth2' as const }
  mocks.parameters.mockResolvedValue({
    ...parameters,
    connection_requirements: [{ ...requirement, allowed_credential_types: ['oauth2'] }],
  })
  mocks.configuration.mockResolvedValue({
    connections: { 'tool-node': oauthCredential },
    reauthorization_required: false,
  })
  mocks.list.mockResolvedValue({ data: [oauthCredential], has_more: false, next_cursor: null })
  mocks.preflight.mockResolvedValue({
    connection_revision: revisionOne,
    ready: false,
    connections: [
      {
        node_id: 'tool-node',
        connection_id: credential.id,
        status: 'reconnect_required',
        check: {
          status: 'invalid',
          reason_code: 'credential_expired',
          retryable: false,
          checked_at: 1,
        },
      },
    ],
  })
  const screen = await render(<App />)
  await expect
    .element(screen.getByRole('status'))
    .toHaveTextContent('share.connections.accounts.expired')
  const picker = screen.getByRole('button', { name: 'Workspace key' })
  await expect.element(picker).toBeEnabled()
  await picker.click()
  await expect
    .element(screen.getByRole('button', { name: 'Workspace key', pressed: true }))
    .toBeVisible()
  await expect.element(screen.getByRole('button', { name: 'Run' })).toBeDisabled()
})

it('defaults new installed-app API keys to Only me and submits that visibility', async () => {
  mocks.creationEnabled = true
  const screen = await render(<App />)
  await screen.getByRole('button', { name: /share.connections.setup.selectConnection/ }).click()
  await screen.getByRole('button', { name: 'plugin.auth.common.addApiKey' }).click()
  const modal = screen.getByRole('dialog', { name: 'plugin.auth.useApiAuth' })
  await expect.element(modal.getByRole('button', { name: /permissionsOnlyMe/ })).toBeVisible()
  await modal.getByLabelText(/API Key/).fill('private-secret')
  await modal.getByRole('button', { name: 'common.operation.save' }).click()
  await expect.poll(() => mocks.create.mock.calls.length).toBe(1)
  expect(mocks.create).toHaveBeenCalledWith({
    params: { provider: requirement.provider },
    body: {
      credentials: { api_key: 'private-secret' },
      name: '',
      type: 'api-key',
      visibility: 'only_me',
    },
  })
})

it('confirms the current workspace selection before entering an app that needs reauthorization', async () => {
  mocks.configuration.mockResolvedValue({
    connections: { 'tool-node': credential },
    reauthorization_required: true,
  })
  const save = createDeferred<{
    connections: { 'tool-node': typeof credential }
    reauthorization_required: boolean
  }>()
  mocks.save.mockReturnValueOnce(save.promise)
  const screen = await render(<App conversationId={conversationA} />)
  const start = screen.getByRole('button', { name: 'share.connections.setup.startUsingApp' })
  await expect.element(start).toBeEnabled()
  await expect.element(screen.getByRole('button', { name: 'Run' })).toBeDisabled()
  await start.click()
  try {
    await expect.element(start).toBeDisabled()
    await expect
      .poll(() => mocks.save.mock.lastCall?.[0])
      .toEqual({
        params: { installed_app_id: TEST_APP_ID },
        body: {
          connection_revision: revisionOne,
          connections: { 'tool-node': credential.id },
          conversation_id: conversationA,
        },
      })
    expect(mocks.start).not.toHaveBeenCalled()
  } finally {
    mocks.configuration.mockResolvedValue({
      connections: { 'tool-node': credential },
      reauthorization_required: false,
    })
    save.resolve({ connections: { 'tool-node': credential }, reauthorization_required: false })
  }

  await expect.poll(() => mocks.start.mock.calls.length).toBe(1)
  await expect.element(screen.getByRole('button', { name: 'Run' })).toBeEnabled()
})
