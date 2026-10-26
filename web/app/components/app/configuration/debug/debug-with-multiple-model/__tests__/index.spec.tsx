import type { Features } from '@/app/components/base/features/types'
import type { consoleClient } from '@/service/console'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import {
  appConfigurationToastManager,
  toast as configurationToast,
} from '@/app/components/app/configuration/toast'
import { FeaturesProvider } from '@/app/components/base/features/context'
import { createFeaturesStore } from '@/app/components/base/features/store'
import { toast } from '@/app/notifications'
import { AppToaster } from '@/app/notifications/app-toaster'
import ConfigContext from '@/context/debug-configuration'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { consoleQuery } from '@/service/console'
import {
  createCatalogModelFixture,
  createModelCatalogFixture,
  seedModelProviderQueries,
} from '@/test/console/model-provider'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import {
  createDebugConfigurationFixture,
  createModelConfigFixture,
} from '@/test/fixtures/debug-configuration'
import { createFileUploadConfigFixture } from '@/test/fixtures/file-upload-config'
import { ModelModeType, TransferMethod } from '@/types/app'
import { APP_CHAT_WITH_MULTIPLE_MODEL_RESTART } from '../../types'
import DebugWithMultipleModel from '../index'

const api = vi.hoisted(() => ({
  stream: vi.fn<typeof import('@/service/base').ssePost>(),
  upload: vi.fn<typeof import('@/service/base').upload>(),
  messages: vi.fn<typeof consoleClient.apps.byAppId.chatMessages.get>(),
  suggestions:
    vi.fn<typeof consoleClient.apps.byAppId.chatMessages.byMessageId.suggestedQuestions.get>(),
}))
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  ssePost: api.stream,
  upload: api.upload,
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'apps.byAppId.chatMessages.get': (input) => api.messages(input),
      'apps.byAppId.chatMessages.byMessageId.suggestedQuestions.get': (input) =>
        api.suggestions(input),
    }),
  }
})
vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useParams: () => ({ appId: 'app-1' }),
  usePathname: () => '/app/app-1/configuration',
}))

const models = [
  { id: 'first', model: 'gpt-4', provider: 'openai', parameters: { temperature: 0.2 } },
  { id: 'second', model: 'gpt-3.5-turbo', provider: 'openai', parameters: { temperature: 0.8 } },
]
const onOpenFeatures = vi.fn()
const onOpenLog = vi.fn()
function Restart() {
  const { eventEmitter } = useEventEmitterContextContext()
  return (
    <button
      type="button"
      onClick={() => eventEmitter?.emit({ type: APP_CHAT_WITH_MULTIPLE_MODEL_RESTART })}
    >
      Restart comparison
    </button>
  )
}
function setup({
  context = {},
  features = {},
  checkCanSend,
}: {
  context?: Parameters<typeof createDebugConfigurationFixture>[0]
  features?: Features
  checkCanSend?: () => boolean
} = {}) {
  const queryClient = createConsoleQueryClient()
  seedModelProviderQueries(queryClient, [
    createModelCatalogFixture({
      models: [
        createCatalogModelFixture({ model_properties: { mode: 'chat' }, features: ['vision'] }),
        createCatalogModelFixture({
          model: 'gpt-3.5-turbo',
          label: { en_US: 'GPT-3.5 Turbo' },
          model_properties: { mode: 'chat' },
        }),
      ],
    }),
  ])
  queryClient.setQueryDefaults(
    consoleQuery.workspaces.current.modelProviders.byProvider.models.parameterRules.get.key(),
    { initialData: { data: [] } },
  )
  const config = createDebugConfigurationFixture({
    appId: 'app-1',
    canTestAndRun: true,
    onOpenFeatures,
    inputs: { audience: 'engineers' },
    modelConfig: createModelConfigFixture({
      provider: 'openai',
      model_id: 'gpt-4',
      mode: ModelModeType.chat,
      configs: {
        prompt_template: 'Explain to {{audience}}',
        prompt_variables: [{ key: 'audience', name: 'Audience', type: 'string', required: true }],
      },
    }),
    ...context,
  })
  renderWithConsoleQuery(
    <NuqsTestingAdapter>
      {/* oxlint-disable-next-line eslint-react/no-context-provider -- use-context-selector requires its own Provider. */}
      <ConfigContext.Provider value={config}>
        <FeaturesProvider features={{ ...createFeaturesStore().getState().features, ...features }}>
          <EventEmitterContextProvider>
            <Restart />
            <DebugWithMultipleModel
              multipleModelConfigs={models}
              onMultipleModelConfigsChange={vi.fn()}
              onDebugWithMultipleModelChange={vi.fn()}
              onOpenLog={onOpenLog}
              checkCanSend={checkCanSend}
            />
            <AppToaster />
            <AppToaster manager={appConfigurationToastManager} />
          </EventEmitterContextProvider>
        </FeaturesProvider>
      </ConfigContext.Provider>
    </NuqsTestingAdapter>,
    { queryClient },
  )
  return userEvent.setup()
}
async function send(user: ReturnType<typeof userEvent.setup>, message = 'Explain RAG') {
  await user.type(screen.getByRole('textbox'), message)
  await user.click(screen.getByRole('button', { name: 'common.operation.send' }))
}
async function deliverAnswers() {
  const requests = api.stream.mock.calls.slice()
  await act(async () => {
    for (const [index, request] of requests.entries()) {
      request[2]?.onData?.(`Answer from model ${index + 1}`, true, {
        messageId: `answer-${index + 1}`,
        conversationId: `conversation-${index + 1}`,
        taskId: `task-${index + 1}`,
      })
      await request[2]?.onCompleted?.()
    }
  })
}
beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset()
  onOpenFeatures.mockClear()
  onOpenLog.mockClear()
  api.stream.mockResolvedValue(undefined)
  api.upload.mockResolvedValue({ id: 'uploaded-file-1' })
  api.messages.mockResolvedValue({ data: [], has_more: false, limit: 10 })
  api.suggestions.mockResolvedValue({ data: [] })
})
afterEach(() => {
  toast.dismiss()
  configurationToast.dismiss()
})

it('sends one question to both configured models and keeps their streamed answers and conversations separate', async () => {
  const user = setup()
  await send(user)
  expect(api.stream).toHaveBeenCalledTimes(2)
  models.forEach((model, index) => {
    expect(api.stream.mock.calls[index]?.[0]).toBe('apps/app-1/chat-messages')
    expect(api.stream.mock.calls[index]?.[1].body).toMatchObject({
      query: 'Explain RAG',
      inputs: { audience: 'engineers' },
      parent_message_id: null,
      model_config: {
        model: { provider: model.provider, name: model.model, completion_params: model.parameters },
      },
    })
  })
  await deliverAnswers()
  expect(await screen.findByText('Answer from model 1')).toBeVisible()
  expect(screen.getByText('Answer from model 2')).toBeVisible()
  await user.click(screen.getAllByRole('button', { name: 'common.operation.log' })[1]!)
  expect(onOpenLog).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ id: 'answer-2', content: 'Answer from model 2' }),
  )
  await send(user, 'Give an example')
  expect(api.stream).toHaveBeenCalledTimes(4)
  for (const index of [0, 1]) {
    expect(api.stream.mock.calls[index + 2]?.[1].body).toMatchObject({
      query: 'Give an example',
      parent_message_id: `answer-${index + 1}`,
      conversation_id: `conversation-${index + 1}`,
    })
  }
})

it('restarts both conversations through the comparison restart event', async () => {
  const user = setup()
  await send(user)
  await deliverAnswers()
  await user.click(screen.getByRole('button', { name: 'Restart comparison' }))
  expect(screen.queryByText('Answer from model 1')).not.toBeInTheDocument()
  expect(screen.queryByText('Answer from model 2')).not.toBeInTheDocument()
  await send(user, 'Start again')
  expect(api.stream).toHaveBeenCalledTimes(4)
  for (const request of api.stream.mock.calls.slice(2)) {
    expect(request[1].body).toMatchObject({ query: 'Start again', parent_message_id: null })
    expect(request[1].body).toHaveProperty('conversation_id', '')
  }
})

it('allows comparison runs with readonly configuration while disabling feature editing', async () => {
  const user = setup({ context: { readonly: true } })
  expect(screen.getByRole('button', { name: 'appDebug.feature.bar.empty' })).toBeDisabled()
  await send(user)
  expect(api.stream).toHaveBeenCalledTimes(2)
  expect(onOpenFeatures).not.toHaveBeenCalled()
})

it('blocks the composer without run permission while allowing feature configuration', async () => {
  const user = setup({ context: { canTestAndRun: false } })
  expect(screen.getByRole('textbox')).toBeDisabled()
  const sendButton = screen.getByRole('button', { name: 'common.operation.send' })
  expect(sendButton).toBeDisabled()
  await user.click(sendButton)
  expect(api.stream).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'appDebug.feature.bar.empty' }))
  expect(onOpenFeatures).toHaveBeenCalledExactlyOnceWith(true)
})

it('does not send to either model when parent validation rejects the request', async () => {
  const checkCanSend = vi.fn(() => false)
  const user = setup({ checkCanSend })
  await send(user)
  expect(checkCanSend).toHaveBeenCalledTimes(1)
  expect(api.stream).not.toHaveBeenCalled()
  expect(screen.queryByText('Explain RAG')).not.toBeInTheDocument()
})

it('reports the required variable name and retains the draft instead of sending', async () => {
  const user = setup({ context: { inputs: {} } })
  await send(user)
  expect(
    await screen.findByText('appDebug.errorMessage.valueOfVarRequired:{"key":"Audience"}'),
  ).toBeVisible()
  expect(screen.getByRole('textbox')).toHaveValue('Explain RAG')
  expect(api.stream).not.toHaveBeenCalled()
})

it('accepts zero for a required number and does not require hidden optional or API-only variables', async () => {
  const user = setup({
    context: {
      inputs: { count: 0 },
      modelConfig: createModelConfigFixture({
        configs: {
          prompt_template: 'Use {{count}}',
          prompt_variables: [
            { key: 'count', name: 'Count', type: 'number', required: true },
            { key: 'optional', name: 'Optional', type: 'string', hide: true, required: false },
            { key: 'external', name: 'External', type: 'api', required: true },
          ],
        },
      }),
    },
  })
  await send(user)
  expect(api.stream).toHaveBeenCalledTimes(2)
  for (const request of api.stream.mock.calls)
    expect(request[1].body).toHaveProperty('inputs', { count: 0 })
})

it('uploads once and includes the attachment only for the model supporting vision', async () => {
  const user = setup({
    features: {
      file: {
        enabled: true,
        allowed_file_types: ['image'],
        allowed_file_upload_methods: [TransferMethod.local_file],
        allowed_file_extensions: [],
        number_limits: 3,
        fileUploadConfig: createFileUploadConfigFixture(),
      },
    },
  })
  const file = new File(['image'], 'diagram.png', { type: 'image/png' })
  fireEvent.drop(screen.getByRole('textbox'), { dataTransfer: { files: [file] } })
  await waitFor(() => expect(api.upload).toHaveBeenCalledTimes(1))
  expect(api.upload.mock.lastCall![0].data.get('file')).toEqual(file)
  await send(user, 'Describe this diagram')
  expect(api.stream).toHaveBeenCalledTimes(2)
  expect(api.stream.mock.calls[0]?.[1].body).toHaveProperty('files', [
    {
      type: 'image',
      transfer_method: TransferMethod.local_file,
      url: '',
      upload_file_id: 'uploaded-file-1',
    },
  ])
  expect(api.stream.mock.calls[1]?.[1].body).toHaveProperty('files', [])
})

it('sends agent-chat questions through the shared comparison composer', async () => {
  const user = setup({ context: { mode: 'agent-chat', isAgent: true } })
  await send(user)
  expect(api.stream).toHaveBeenCalledTimes(2)
  await deliverAnswers()
  expect(await screen.findByText('Answer from model 1')).toBeVisible()
  expect(screen.getByText('Answer from model 2')).toBeVisible()
})

it('shows the selected completion models without a shared chat composer', () => {
  setup({ context: { mode: 'completion' } })
  expect(screen.getByRole('button', { name: /^GPT-4/ })).toBeVisible()
  expect(screen.getByRole('button', { name: /^GPT-3.5 Turbo/ })).toBeVisible()
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'common.operation.send' })).not.toBeInTheDocument()
})

it.each([true, false])(
  'applies the opening feature to both model conversations (%s)',
  async (enabled) => {
    const user = setup({
      features: {
        opening: {
          enabled,
          opening_statement: 'Welcome to the comparison',
          suggested_questions: ['Compare retrieval methods'],
        },
      },
    })
    expect(screen.queryAllByText('Welcome to the comparison')).toHaveLength(enabled ? 2 : 0)
    await send(user)
    expect(api.stream).toHaveBeenCalledTimes(2)
    for (const request of api.stream.mock.calls) {
      expect(request[1].body).toMatchObject({
        model_config: {
          opening_statement: enabled ? 'Welcome to the comparison' : '',
          suggested_questions: enabled ? ['Compare retrieval methods'] : [],
        },
      })
    }
  },
)

it('shows a model transport error while another model continues answering', async () => {
  const user = setup()
  await send(user)
  await act(async () => {
    api.stream.mock.calls[0]?.[2]?.onNotifyError?.('Model is unavailable')
    api.stream.mock.calls[1]?.[2]?.onData?.('The other model answered', true, {
      messageId: 'answer-2',
      conversationId: 'conversation-2',
      taskId: 'task-2',
    })
    await api.stream.mock.calls[1]?.[2]?.onCompleted?.()
  })
  expect(await screen.findByText('Model is unavailable')).toBeVisible()
  expect(screen.getByText('The other model answered')).toBeVisible()
})
