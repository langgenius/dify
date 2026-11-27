import type {
  InstalledAppParametersResponse,
  InstalledConnectionPreflightPayload,
} from '@dify/contracts/api/console/installed-apps/types.gen'
import type { WorkflowRunSnapshot } from '@/app/components/share/text-generation/workflow-run-configuration'
import { QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { render } from 'vitest-browser-react'
import {
  captureWorkflowRunConfiguration,
  isWorkflowRunSnapshotCurrent,
} from '@/app/components/share/text-generation/workflow-run-configuration'
import { TEST_APP_ID } from '@/test/console/ids'
import { createDeferred } from '@/test/deferred'
import { apiError, setupFakeApi } from '@/test/fake-api'
import { createTestQueryClient } from '@/test/query-client'
import { InstalledConnectionSetup } from '..'
import { InstalledAppConnectionsProvider } from '../provider'
import { useInstalledAppConnections } from '../use-installed-app-connections'

const revisionOne = '00000000-0000-4000-8000-000000000011'
const revisionTwo = '00000000-0000-4000-8000-000000000012'
const workspaceKey = '00000000-0000-4000-8000-000000000021'
const alternativeKey = '00000000-0000-4000-8000-000000000022'
const createdConversation = '00000000-0000-4000-8000-000000000032'
const anotherConversation = '00000000-0000-4000-8000-000000000033'

const mocks = vi.hoisted(() => ({
  parameters: vi.fn(),
  configuration: vi.fn(),
  list: vi.fn(),
  save: vi.fn(),
  preflight: vi.fn(),
}))

// boundary: permission and provider transport is outside connection confirmation.
vi.mock('@/hooks/use-credential-permissions', () => ({
  useCredentialPermissions: () => ({
    canUseCredential: true,
    canCreateCredential: false,
    canManageCredential: false,
  }),
}))

// boundary: third-party plugin authorization is outside connection confirmation.
vi.mock('@/app/components/plugins/plugin-auth/hooks/use-plugin-auth', () => ({
  usePluginAuth: () => ({
    isAuthorized: true,
    canOAuth: false,
    canApiKey: false,
    isLoading: false,
    notAllowCustomCredential: true,
    invalidPluginCredentialInfo: vi.fn(),
    credentials: [],
  }),
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
      },
    },
  },
})

const credential = {
  id: workspaceKey,
  provider: 'langgenius/github/github',
  name: 'Workspace key',
  credential_type: 'api-key' as const,
  credential_status: null,
  account_label: null,
  created_at: 1,
  updated_at: 1,
  expires_at: null,
  last_active_at: null,
}
const alternative = { ...credential, id: alternativeKey }
const parameters: InstalledAppParametersResponse = {
  annotation_reply: {},
  connection_revision: revisionOne,
  requires_end_user_connections: true,
  connection_requirements: [
    {
      node_id: 'tool',
      node_ids: ['tool'],
      provider: credential.provider,
      provider_label: 'GitHub',
      verified: false,
      title: 'Search',
      purpose: '',
      icon: '',
      icon_dark: null,
      plugin_unique_identifier: 'langgenius/github',
      allowed_credential_types: ['api-key'],
    },
  ],
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

beforeEach(() => {
  mocks.parameters.mockReset().mockResolvedValue(parameters)
  mocks.configuration
    .mockReset()
    .mockResolvedValue({ connections: { tool: credential }, reauthorization_required: false })
  mocks.list
    .mockReset()
    .mockResolvedValue({ data: [credential, alternative], has_more: false, next_cursor: null })
  mocks.save.mockReset()
  mocks.preflight
    .mockReset()
    .mockImplementation(({ body }: { body: InstalledConnectionPreflightPayload }) =>
      Promise.resolve({
        connection_revision: body.connection_revision,
        ready: true,
        connections: [
          {
            node_id: 'tool',
            connection_id: body.connections.tool,
            status: 'connected',
            check: null,
          },
        ],
      }),
    )
})

function ChatSession({ onComplete, onSwitch }: { onComplete: () => void; onSwitch: () => void }) {
  const [answer, setAnswer] = useState('')
  const state = useInstalledAppConnections()
  return (
    <>
      <button
        onClick={() => {
          setAnswer('The streamed answer')
          onComplete()
        }}
      >
        Complete first response
      </button>
      <button onClick={onSwitch}>Switch conversation</button>
      <button
        onClick={() => {
          void state.onSelect('tool', alternative.id)
        }}
      >
        Change connection
      </button>
      <button
        onClick={() => {
          void state.retry()
        }}
      >
        Refresh requirements
      </button>
      <p>{answer}</p>
      <output aria-label="Selected connection">{state.selections.tool ?? 'none'}</output>
      <output aria-label="Connection error">{state.error?.message ?? 'none'}</output>
      <output aria-label="Run revision">
        {state.runConfiguration?.connection_revision ?? 'blocked'}
      </output>
    </>
  )
}

function SetupControls() {
  const state = useInstalledAppConnections()
  return (
    <>
      <InstalledConnectionSetup onStart={() => {}} />
      <button disabled={!state.canRun}>Run</button>
    </>
  )
}

function App({
  initialConversation,
  showSetup = false,
}: {
  initialConversation?: string
  showSetup?: boolean
}) {
  const [conversationId, setConversationId] = useState(initialConversation)
  const [client] = useState(createTestQueryClient)
  return (
    <QueryClientProvider client={client}>
      <InstalledAppConnectionsProvider installedAppId={TEST_APP_ID} conversationId={conversationId}>
        {showSetup && <SetupControls />}
        <ChatSession
          onComplete={() => setConversationId(createdConversation)}
          onSwitch={() => setConversationId(anotherConversation)}
        />
      </InstalledAppConnectionsProvider>
    </QueryClientProvider>
  )
}

it('keeps streamed content when the first response gains a conversation ID and requirements refresh', async () => {
  const screen = await render(<App />)
  await expect
    .element(screen.getByRole('status', { name: 'Run revision' }))
    .toHaveTextContent(revisionOne)

  await screen.getByRole('button', { name: 'Complete first response' }).click()

  await expect.element(screen.getByText('The streamed answer')).toBeVisible()
  await expect
    .poll(() =>
      mocks.configuration.mock.calls.some(
        ([input]) => input.query.conversation_id === createdConversation,
      ),
    )
    .toBe(true)
  mocks.parameters.mockResolvedValue({ ...parameters, connection_revision: revisionTwo })
  await screen.getByRole('button', { name: 'Refresh requirements' }).click()
  await expect
    .element(screen.getByRole('status', { name: 'Run revision' }))
    .toHaveTextContent(revisionTwo)
  await expect.element(screen.getByText('The streamed answer')).toBeVisible()
})

it.each(['success', 'failure'] as const)(
  'keeps a late save %s attached to its original conversation after switching',
  async (outcome) => {
    const save = createDeferred<{
      connections: { tool: typeof credential }
      reauthorization_required: boolean
    }>()
    mocks.save.mockReturnValueOnce(save.promise)
    const screen = await render(<App />)
    await expect
      .element(screen.getByRole('status', { name: 'Run revision' }))
      .toHaveTextContent(revisionOne)
    await screen.getByRole('button', { name: 'Change connection' }).click()
    await expect.poll(() => mocks.save.mock.calls.length).toBe(1)
    await screen.getByRole('button', { name: 'Switch conversation' }).click()
    await expect
      .poll(() =>
        mocks.configuration.mock.calls.some(
          ([input]) => input.query.conversation_id === anotherConversation,
        ),
      )
      .toBe(true)
    if (outcome === 'success')
      save.resolve({ connections: { tool: alternative }, reauthorization_required: false })
    else save.reject(apiError({ status: 503, message: 'Old conversation save failed' }))
    await save.promise.catch(() => {})
    await expect
      .element(screen.getByRole('status', { name: 'Run revision' }))
      .toHaveTextContent(revisionOne)
    await expect
      .element(screen.getByRole('status', { name: 'Selected connection' }))
      .toHaveTextContent(credential.id)
    await expect
      .element(screen.getByRole('status', { name: 'Connection error' }))
      .toHaveTextContent('none')
  },
)

it('allows running after confirmation accepts a changed connection revision', async () => {
  mocks.parameters.mockResolvedValue({ ...parameters, connection_revision: revisionTwo })
  mocks.configuration.mockResolvedValue({
    connections: { tool: credential },
    reauthorization_required: true,
  })
  mocks.save.mockResolvedValue({
    connections: { tool: alternative },
    reauthorization_required: false,
  })
  mocks.configuration
    .mockResolvedValueOnce({
      connections: { tool: credential },
      reauthorization_required: true,
    })
    .mockResolvedValueOnce({
      connections: { tool: alternative },
      reauthorization_required: false,
    })

  const screen = await render(<App showSetup initialConversation={createdConversation} />)
  await expect.element(screen.getByRole('button', { name: 'Run' })).toBeDisabled()
  const start = screen.getByRole('button', {
    name: 'share.connections.setup.startUsingApp',
  })
  await expect.element(start).toBeEnabled()
  await start.click()

  await expect.element(screen.getByRole('button', { name: 'Run' })).toBeEnabled()
})

function CaptureRun({ onCapture }: { onCapture: (snapshot: WorkflowRunSnapshot) => void }) {
  const state = useInstalledAppConnections()
  return (
    <button
      disabled={!state.canRun}
      onClick={() => {
        const snapshot = captureWorkflowRunConfiguration(state, state)
        if (snapshot) onCapture(snapshot)
      }}
    >
      Queue workflow run
    </button>
  )
}

function ModalWorkflowApp() {
  const [client] = useState(createTestQueryClient)
  const [open, setOpen] = useState(true)
  const [conversationId, setConversationId] = useState<string>()
  const [snapshot, setSnapshot] = useState<WorkflowRunSnapshot>()
  const [snapshotStatus, setSnapshotStatus] = useState('none')
  return (
    <QueryClientProvider client={client}>
      {open && (
        <InstalledAppConnectionsProvider
          installedAppId={TEST_APP_ID}
          conversationId={conversationId}
        >
          <CaptureRun onCapture={setSnapshot} />
          <ChatSession
            onComplete={() => {}}
            onSwitch={() => setConversationId(anotherConversation)}
          />
        </InstalledAppConnectionsProvider>
      )}
      <button onClick={() => setOpen(false)}>Close app</button>
      <button
        onClick={() => {
          if (snapshot)
            setSnapshotStatus(isWorkflowRunSnapshotCurrent(snapshot) ? 'current' : 'expired')
        }}
      >
        Check queued run
      </button>
      <output aria-label="Queued run status">{snapshotStatus}</output>
    </QueryClientProvider>
  )
}

it('keeps homepage modal runs valid only while their provider conversation and revision remain active', async () => {
  window.history.replaceState({}, '', '/')
  const screen = await render(<ModalWorkflowApp />)
  const queue = screen.getByRole('button', { name: 'Queue workflow run' })
  const check = screen.getByRole('button', { name: 'Check queued run' })
  const status = screen.getByRole('status', { name: 'Queued run status' })

  await expect.element(queue).toBeEnabled()
  await queue.click()
  await check.click()
  await expect.element(status).toHaveTextContent('current')

  await screen.getByRole('button', { name: 'Switch conversation' }).click()
  await expect
    .poll(() =>
      mocks.configuration.mock.calls.some(
        ([input]) => input.query.conversation_id === anotherConversation,
      ),
    )
    .toBe(true)
  await check.click()
  await expect.element(status).toHaveTextContent('expired')

  await expect.element(queue).toBeEnabled()
  await queue.click()
  await check.click()
  await expect.element(status).toHaveTextContent('current')
  mocks.parameters.mockResolvedValue({ ...parameters, connection_revision: revisionTwo })
  await screen.getByRole('button', { name: 'Refresh requirements' }).click()
  await expect
    .element(screen.getByRole('status', { name: 'Run revision' }))
    .toHaveTextContent(revisionTwo)
  await check.click()
  await expect.element(status).toHaveTextContent('expired')

  await queue.click()
  await check.click()
  await expect.element(status).toHaveTextContent('current')
  await screen.getByRole('button', { name: 'Close app' }).click()
  await expect.element(queue).not.toBeInTheDocument()
  await check.click()
  await expect.element(status).toHaveTextContent('expired')
})
