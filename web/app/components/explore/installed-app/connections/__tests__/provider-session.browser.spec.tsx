import type {
  InstalledAppParametersResponse,
  InstalledConnectionPreflightPayload,
} from '@dify/contracts/api/console/installed-apps/types.gen'
import { QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { render } from 'vitest-browser-react'
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
