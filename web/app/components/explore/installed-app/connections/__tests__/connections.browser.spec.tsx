import type {
  InstalledAppParametersResponse,
  InstalledConnectionPreflightPayload,
} from '@dify/contracts/api/console/installed-apps/types.gen'
import { QueryClientProvider } from '@tanstack/react-query'
import { render } from 'vitest-browser-react'
import { createDeferred } from '@/test/deferred'
import { createTestQueryClient } from '@/test/query-client'
import { InstalledConnectionSetup } from '..'
import { InstalledAppConnectionsProvider } from '../provider'
import { useInstalledAppConnections } from '../use-installed-app-connections'

const mocks = vi.hoisted(() => ({
  parameters: vi.fn(),
  configuration: vi.fn(),
  list: vi.fn(),
  save: vi.fn(),
  preflight: vi.fn(),
  start: vi.fn(),
  run: vi.fn(),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'installedApps.byInstalledAppId.parameters.get': mocks.parameters,
      'installedApps.byInstalledAppId.connections.configuration.get': mocks.configuration,
      'installedApps.byInstalledAppId.connections.configuration.put': mocks.save,
      'installedApps.byInstalledAppId.connections.get': mocks.list,
      'installedApps.byInstalledAppId.connections.preflight.post': mocks.preflight,
      'workspaces.current.tools.builtin.get': () => [],
      'workspaces.current.toolProvider.builtin.byProvider.credential.schema.byCredentialType.get':
        () => [],
    }),
  }
})

vi.mock('@/hooks/use-credential-permissions', () => ({
  useCredentialPermissions: () => ({
    canUseCredential: true,
    canCreateCredential: false,
    canManageCredential: false,
  }),
}))

vi.mock('@/app/components/plugins/plugin-auth/hooks/use-plugin-auth', () => ({
  usePluginAuth: () => ({
    isAuthorized: true,
    canOAuth: false,
    canApiKey: false,
    isLoading: false,
    notAllowCustomCredential: true,
    invalidPluginCredentialInfo: vi.fn(),
    credentials: [
      {
        id: 'workspace-key',
        provider: 'langgenius/github/github',
        name: 'Workspace key',
        credential_type: 'api-key',
        is_default: false,
      },
      {
        id: 'invisible-key',
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
  title: 'Search repositories',
  purpose: 'Find repositories',
  icon: '',
  icon_dark: null,
  plugin_unique_identifier: 'langgenius/github',
  allowed_credential_types: ['api-key' as const],
}
const credential = {
  id: 'workspace-key',
  provider: requirement.provider,
  name: 'Workspace key',
  credential_type: 'api-key' as const,
  credential_status: 'connected' as const,
  account_label: null,
  created_at: 1,
  updated_at: 1,
  expires_at: null,
  last_active_at: null,
}
const parameters: InstalledAppParametersResponse = {
  annotation_reply: {},
  connection_requirements: [requirement],
  connection_revision: 'published-revision',
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
  return (
    <QueryClientProvider client={createTestQueryClient()}>
      <InstalledAppConnectionsProvider
        installedAppId="installed-app"
        conversationId={conversationId}
      >
        <InstalledConnectionSetup onStart={mocks.start} />
        <RunControl />
      </InstalledAppConnectionsProvider>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  mocks.parameters.mockReset().mockResolvedValue(parameters)
  mocks.configuration
    .mockReset()
    .mockResolvedValue({ connections: { 'tool-node': null }, reauthorization_required: false })
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

it('saves a workspace selection for the current conversation and waits for fresh preflight before running', async () => {
  const check = createDeferred<{
    connection_revision: string
    ready: boolean
    connections: { node_id: string; connection_id: string; status: 'connected'; check: null }[]
  }>()
  const screen = await render(<App conversationId="conversation-a" />)
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
    params: { installed_app_id: 'installed-app' },
    body: {
      connection_revision: 'published-revision',
      connections: { 'tool-node': 'workspace-key' },
      conversation_id: 'conversation-a',
    },
  })
  await expect.element(start).toBeDisabled()
  await expect.element(screen.getByRole('button', { name: 'Run' })).toBeDisabled()
  check.resolve({
    connection_revision: 'published-revision',
    ready: true,
    connections: [
      { node_id: 'tool-node', connection_id: 'workspace-key', status: 'connected', check: null },
    ],
  })
  await expect.element(start).toBeEnabled()
  await screen.getByRole('button', { name: 'Run' }).click()
  expect(mocks.run).toHaveBeenCalledWith({
    connection_revision: 'published-revision',
    connections: { 'tool-node': 'workspace-key' },
    conversation_id: 'conversation-a',
  })
})

it('keeps running disabled when a saved workspace credential fails preflight', async () => {
  mocks.configuration.mockResolvedValue({
    connections: { 'tool-node': credential },
    reauthorization_required: false,
  })
  mocks.preflight.mockResolvedValue({
    connection_revision: 'published-revision',
    ready: false,
    connections: [
      { node_id: 'tool-node', connection_id: credential.id, status: 'invalid', check: null },
    ],
  })
  const screen = await render(<App />)
  await expect.element(screen.getByText('plugin.auth.unavailable', { exact: true })).toBeVisible()
  await expect.element(screen.getByRole('button', { name: 'Run' })).toBeDisabled()
  await expect
    .element(screen.getByRole('button', { name: 'share.connections.setup.startUsingApp' }))
    .toBeDisabled()
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
  const screen = await render(<App conversationId="conversation-a" />)
  const start = screen.getByRole('button', { name: 'share.connections.setup.startUsingApp' })
  await expect.element(start).toBeEnabled()
  await expect.element(screen.getByRole('button', { name: 'Run' })).toBeDisabled()
  await start.click()
  await expect.element(start).toBeDisabled()
  expect(mocks.start).not.toHaveBeenCalled()
  expect(mocks.save).toHaveBeenCalledWith({
    params: { installed_app_id: 'installed-app' },
    body: {
      connection_revision: 'published-revision',
      connections: { 'tool-node': credential.id },
      conversation_id: 'conversation-a',
    },
  })

  save.resolve({ connections: { 'tool-node': credential }, reauthorization_required: false })

  await expect.poll(() => mocks.start.mock.calls.length).toBe(1)
  await expect.element(screen.getByRole('button', { name: 'Run' })).toBeEnabled()
})
