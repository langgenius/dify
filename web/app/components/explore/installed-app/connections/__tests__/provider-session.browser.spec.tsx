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
import { createDeferred } from '@/test/deferred'
import { createTestQueryClient } from '@/test/query-client'
import { InstalledAppConnectionsProvider } from '../provider'
import { useInstalledAppConnections } from '../use-installed-app-connections'

const mocks = vi.hoisted(() => ({
  parameters: vi.fn(),
  configuration: vi.fn(),
  list: vi.fn(),
  save: vi.fn(),
  preflight: vi.fn(),
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
    }),
  }
})

const credential = {
  id: 'workspace-key',
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
const alternative = { ...credential, id: 'alternative-key' }
const parameters: InstalledAppParametersResponse = {
  annotation_reply: {},
  connection_revision: 'revision-one',
  requires_end_user_connections: true,
  connection_requirements: [
    {
      node_id: 'tool',
      node_ids: ['tool'],
      provider: credential.provider,
      provider_label: 'GitHub',
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
      <button onClick={() => void state.retry()}>Refresh requirements</button>
      <p>{answer}</p>
      <output aria-label="Selected connection">{state.selections.tool ?? 'none'}</output>
      <output aria-label="Connection error">{state.error?.message ?? 'none'}</output>
      <output aria-label="Run revision">
        {state.runConfiguration?.connection_revision ?? 'blocked'}
      </output>
    </>
  )
}

function App() {
  const [conversationId, setConversationId] = useState<string>()
  const [client] = useState(createTestQueryClient)
  return (
    <QueryClientProvider client={client}>
      <InstalledAppConnectionsProvider
        installedAppId="installed-app"
        conversationId={conversationId}
      >
        <ChatSession
          onComplete={() => setConversationId('created-conversation')}
          onSwitch={() => setConversationId('another-conversation')}
        />
      </InstalledAppConnectionsProvider>
    </QueryClientProvider>
  )
}

it('keeps streamed content when the first response gains a conversation ID and requirements refresh', async () => {
  const screen = await render(<App />)
  await expect
    .element(screen.getByRole('status', { name: 'Run revision' }))
    .toHaveTextContent('revision-one')

  await screen.getByRole('button', { name: 'Complete first response' }).click()

  await expect.element(screen.getByText('The streamed answer')).toBeVisible()
  await expect
    .poll(() =>
      mocks.configuration.mock.calls.some(
        ([input]) => input.query.conversation_id === 'created-conversation',
      ),
    )
    .toBe(true)
  mocks.parameters.mockResolvedValue({ ...parameters, connection_revision: 'revision-two' })
  await screen.getByRole('button', { name: 'Refresh requirements' }).click()
  await expect
    .element(screen.getByRole('status', { name: 'Run revision' }))
    .toHaveTextContent('revision-two')
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
      .toHaveTextContent('revision-one')
    await screen.getByRole('button', { name: 'Change connection' }).click()
    await expect.poll(() => mocks.save.mock.calls.length).toBe(1)
    await screen.getByRole('button', { name: 'Switch conversation' }).click()
    await expect
      .poll(() =>
        mocks.configuration.mock.calls.some(
          ([input]) => input.query.conversation_id === 'another-conversation',
        ),
      )
      .toBe(true)
    if (outcome === 'success')
      save.resolve({ connections: { tool: alternative }, reauthorization_required: false })
    else save.reject(new Error('Old conversation save failed'))
    await save.promise.catch(() => {})
    await expect
      .element(screen.getByRole('status', { name: 'Run revision' }))
      .toHaveTextContent('revision-one')
    await expect
      .element(screen.getByRole('status', { name: 'Selected connection' }))
      .toHaveTextContent(credential.id)
    await expect
      .element(screen.getByRole('status', { name: 'Connection error' }))
      .toHaveTextContent('none')
  },
)

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
          installedAppId="installed-app"
          conversationId={conversationId}
        >
          <CaptureRun onCapture={setSnapshot} />
          <ChatSession
            onComplete={() => {}}
            onSwitch={() => setConversationId('another-conversation')}
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
        ([input]) => input.query.conversation_id === 'another-conversation',
      ),
    )
    .toBe(true)
  await check.click()
  await expect.element(status).toHaveTextContent('expired')

  await expect.element(queue).toBeEnabled()
  await queue.click()
  await check.click()
  await expect.element(status).toHaveTextContent('current')
  mocks.parameters.mockResolvedValue({ ...parameters, connection_revision: 'revision-two' })
  await screen.getByRole('button', { name: 'Refresh requirements' }).click()
  await expect
    .element(screen.getByRole('status', { name: 'Run revision' }))
    .toHaveTextContent('revision-two')
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
