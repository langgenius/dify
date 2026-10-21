import type { ComponentProps } from 'react'
import type { Features } from '@/app/components/base/features/types'
import type { consoleClient } from '@/service/console'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { useState } from 'react'
import {
  appConfigurationToastManager,
  toast as configurationToast,
} from '@/app/components/app/configuration/toast'
import { FeaturesProvider } from '@/app/components/base/features/context'
import { createFeaturesStore } from '@/app/components/base/features/store'
import { toast } from '@/app/notifications'
import { AppToaster } from '@/app/notifications/app-toaster'
import ConfigContext from '@/context/debug-configuration'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { consoleQuery } from '@/service/console'
import {
  createCatalogModelFixture,
  createModelCatalogFixture,
  seedModelProviderQueries,
} from '@/test/console/model-provider'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import {
  createDebugConfigurationFixture,
  createModelConfigFixture,
} from '@/test/fixtures/debug-configuration'
import { createFileUploadConfigFixture } from '@/test/fixtures/file-upload-config'
import { ModelModeType, TransferMethod } from '@/types/app'
import Debug from '../index'

type DebugProps = ComponentProps<typeof Debug>
const api = vi.hoisted(() => ({
  stream: vi.fn<typeof import('@/service/base').ssePost>(),
  upload: vi.fn<typeof import('@/service/base').upload>(),
  messages: vi.fn<typeof consoleClient.apps.byAppId.chatMessages.get>(),
  suggestions:
    vi.fn<typeof consoleClient.apps.byAppId.chatMessages.byMessageId.suggestedQuestions.get>(),
  message: vi.fn<typeof consoleClient.apps.byAppId.messages.byMessageId.get>(),
  agentLog: vi.fn<typeof consoleClient.apps.byAppId.agent.logs.get>(),
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
      'apps.byAppId.messages.byMessageId.get': (input) => api.message(input),
      'apps.byAppId.agent.logs.get': (input) => api.agentLog(input),
    }),
  }
})
vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useParams: () => ({ appId: 'app-1' }),
  usePathname: () => '/app/app-1/configuration',
}))

const comparisonModels = [
  { id: 'first', model: 'gpt-4', provider: 'openai', parameters: { temperature: 0.2 } },
  { id: 'second', model: 'gpt-3.5-turbo', provider: 'openai', parameters: { temperature: 0.8 } },
]
const fileConfig = {
  enabled: true,
  allowed_file_types: ['image'],
  allowed_file_upload_methods: [TransferMethod.local_file, TransferMethod.remote_url],
  allowed_file_extensions: [],
  number_limits: 3,
  fileUploadConfig: createFileUploadConfigFixture(),
}
function setup({
  context = {},
  multiple = false,
  models = comparisonModels,
  features = {},
  configured = true,
}: {
  context?: Parameters<typeof createDebugConfigurationFixture>[0]
  multiple?: boolean
  models?: DebugProps['multipleModelConfigs']
  features?: Features
  configured?: boolean
} = {}) {
  const queryClient = createConsoleQueryClient()
  seedModelProviderQueries(
    queryClient,
    configured
      ? [
          createModelCatalogFixture({
            models: [
              createCatalogModelFixture({
                features: ['vision'],
                model_properties: { mode: 'chat' },
              }),
              createCatalogModelFixture({
                model: 'gpt-3.5-turbo',
                label: { en_US: 'GPT-3.5 Turbo' },
                model_properties: { mode: 'chat' },
              }),
            ],
          }),
        ]
      : [],
  )
  queryClient.setQueryDefaults(
    consoleQuery.workspaces.current.modelProviders.byProvider.models.parameterRules.get.key(),
    { initialData: { data: [] } },
  )
  const initial = createDebugConfigurationFixture({
    appId: 'app-1',
    canTestAndRun: true,
    hasSetBlockStatus: { context: false, query: true, history: true },
    modelConfig: createModelConfigFixture({
      provider: 'openai',
      model_id: 'gpt-4',
      mode: ModelModeType.chat,
      configs: { prompt_template: 'Answer the question', prompt_variables: [] },
    }),
    ...context,
  })
  const onSetting = vi.fn()
  const setModel = vi.fn<DebugProps['modelParameterParams']['setModel']>()
  const onCompletionParamsChange =
    vi.fn<DebugProps['modelParameterParams']['onCompletionParamsChange']>()
  function Owner() {
    const [inputs, setInputs] = useState(initial.inputs)
    const [formattingChanged, setFormattingChanged] = useState(false)
    const [multipleEnabled, setMultipleEnabled] = useState(multiple)
    const [configs, setConfigs] = useState(models)
    return (
      <NuqsTestingAdapter>
        {/* oxlint-disable-next-line eslint-react/no-context-provider -- use-context-selector requires its own Provider. */}
        <ConfigContext.Provider
          value={{ ...initial, inputs, setInputs, formattingChanged, setFormattingChanged }}
        >
          <FeaturesProvider
            features={{
              ...createFeaturesStore().getState().features,
              file: { ...fileConfig, enabled: false },
              ...features,
            }}
          >
            <EventEmitterContextProvider>
              <button type="button" onClick={() => setFormattingChanged(true)}>
                Change prompt configuration
              </button>
              <Debug
                inputs={inputs}
                onSetting={onSetting}
                debugWithMultipleModel={multipleEnabled}
                multipleModelConfigs={configs}
                modelParameterParams={{ setModel, onCompletionParamsChange }}
                onMultipleModelConfigsChange={(enabled, next) => {
                  setMultipleEnabled(enabled)
                  setConfigs(next)
                }}
              />
              <AppToaster />
              <AppToaster manager={appConfigurationToastManager} />
            </EventEmitterContextProvider>
          </FeaturesProvider>
        </ConfigContext.Provider>
      </NuqsTestingAdapter>
    )
  }
  return {
    ...renderWithConsoleQuery(<Owner />, { queryClient }),
    user: userEvent.setup(),
    onSetting,
    setModel,
    onCompletionParamsChange,
  }
}
async function sendChat(user: ReturnType<typeof userEvent.setup>, query = 'Test question') {
  await user.type(screen.getByPlaceholderText(/^common.chat.inputPlaceholder/), query)
  await user.click(screen.getByRole('button', { name: 'common.operation.send' }))
}
const run = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: 'appDebug.inputs.run' }))
async function deliver(index = 0, answer = 'Generated answer') {
  const handlers = api.stream.mock.calls[index]![2]!
  await act(async () => {
    handlers.onData?.(answer, true, {
      messageId: `answer-${index}`,
      conversationId: `conversation-${index}`,
      taskId: `task-${index}`,
    })
    await handlers.onCompleted?.()
  })
}
const variableModel = () =>
  createModelConfigFixture({
    provider: 'openai',
    model_id: 'gpt-4',
    mode: ModelModeType.chat,
    configs: {
      prompt_template: 'Answer {{question}}',
      prompt_variables: [
        { key: 'question', name: 'Question', type: 'string', required: true, is_context_var: true },
      ],
    },
  })
const createMessage = (
  id: string,
): Awaited<ReturnType<typeof consoleClient.apps.byAppId.messages.byMessageId.get>> => ({
  id,
  conversation_id: 'conversation-1',
  agent_thoughts: [],
  metadata: {},
  from_source: 'console',
  provider_response_latency: 0,
  status: 'normal',
  answer: 'Generated answer',
  query: 'Test question',
  created_at: 1710000000,
  inputs: {},
  feedbacks: [],
  message: [{ role: 'user', text: `Prompt for ${id}` }],
  message_files: [],
  answer_tokens: 10,
  message_tokens: 5,
  parent_message_id: null,
})
beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset()
  api.stream.mockResolvedValue(undefined)
  api.upload.mockResolvedValue({ id: 'uploaded-image' })
  api.messages.mockResolvedValue({ data: [], has_more: false, limit: 10 })
  api.suggestions.mockResolvedValue({ data: [] })
  api.message.mockImplementation(async ({ params }) => createMessage(params.message_id))
})
afterEach(() => {
  toast.dismiss()
  configurationToast.dismiss()
})

it('offers provider management when no provider is configured', async () => {
  const { user, onSetting } = setup({ configured: false, context: { mode: 'completion' } })
  await user.click(screen.getByRole('button', { name: 'appDebug.manageModels' }))
  expect(onSetting).toHaveBeenCalledTimes(1)
})
it('explains that a model must be selected when the provider exists', () => {
  setup({
    context: {
      mode: 'completion',
      modelConfig: createModelConfigFixture({ provider: 'openai', model_id: '' }),
    },
  })
  expect(screen.getByText('appDebug.noModelSelected')).toBeVisible()
})
it('preserves edited variables when the chat input panel is collapsed and reopened', async () => {
  const { user } = setup({ context: { modelConfig: variableModel() } })
  await user.type(screen.getByRole('textbox', { name: 'Question' }), 'What is RAG?')
  const toggle = screen.getByRole('button', { name: 'workflow.panel.userInputField' })
  await user.click(toggle)
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await user.click(toggle)
  expect(await screen.findByRole('textbox', { name: 'Question' })).toHaveValue('What is RAG?')
  await sendChat(user)
  expect(api.stream.mock.lastCall![1].body).toHaveProperty('inputs', { question: 'What is RAG?' })
})
it.each([false, true])(
  'refreshes the real conversation with readonly configuration=%s',
  async (readonly) => {
    const { user } = setup({ context: { readonly } })
    await sendChat(user)
    await deliver()
    expect(await screen.findByText('Generated answer')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'common.operation.refresh' }))
    expect(screen.queryByText('Generated answer')).not.toBeInTheDocument()
    await sendChat(user, 'New question')
    expect(api.stream.mock.lastCall![1].body).toMatchObject({
      parent_message_id: null,
      conversation_id: '',
    })
  },
)
it('hides refresh and disables sending without test permission', () => {
  setup({ context: { canTestAndRun: false } })
  expect(screen.queryByRole('button', { name: 'common.operation.refresh' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'common.operation.send' })).toBeDisabled()
})
it.each([false, true])(
  'retains or resets the conversation after formatting changes (confirm=%s)',
  async (confirm) => {
    const { user } = setup()
    await sendChat(user)
    await deliver()
    await user.click(screen.getByRole('button', { name: 'Change prompt configuration' }))
    expect(await screen.findByText('appDebug.formattingChangedTitle')).toBeVisible()
    if (confirm)
      await user.click(screen.getAllByRole('button', { name: 'common.operation.refresh' })[1]!)
    else await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    expect(screen.queryByText('appDebug.formattingChangedTitle')).not.toBeInTheDocument()
    if (confirm) expect(screen.queryByText('Generated answer')).not.toBeInTheDocument()
    else expect(screen.getByText('Generated answer')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Change prompt configuration' }))
    expect(await screen.findByText('appDebug.formattingChangedTitle')).toBeVisible()
  },
)
it.each([
  [{ context: false, history: false, query: true }, 'historyNoBeEmpty'],
  [{ context: false, history: true, query: false }, 'queryNoBeEmpty'],
] as const)(
  'blocks advanced chat with missing prompt blocks: %s',
  async (hasSetBlockStatus, error) => {
    const { user } = setup({
      context: { isAdvancedMode: true, modelModeType: ModelModeType.completion, hasSetBlockStatus },
    })
    await sendChat(user)
    expect(await screen.findByText(`appDebug.otherError.${error}`)).toBeVisible()
    expect(api.stream).not.toHaveBeenCalled()
  },
)
it('validates a required completion input and sends the corrected value', async () => {
  const { user } = setup({ context: { mode: 'completion', modelConfig: variableModel() } })
  await run(user)
  expect(
    await screen.findByText('appDebug.errorMessage.valueOfVarRequired:{"key":"Question"}'),
  ).toBeVisible()
  expect(api.stream).not.toHaveBeenCalled()
  await user.type(screen.getByRole('textbox', { name: 'Question' }), 'Explain retrieval')
  await run(user)
  expect(api.stream).toHaveBeenCalledTimes(1)
  expect(api.stream.mock.lastCall![0]).toBe('apps/app-1/completion-messages')
  expect(api.stream.mock.lastCall![1].body).toMatchObject({
    inputs: { question: 'Explain retrieval' },
    model_config: {
      pre_prompt: 'Answer {{question}}',
      dataset_query_variable: 'question',
      model: { provider: 'openai', name: 'gpt-4' },
    },
  })
  const handlers = api.stream.mock.lastCall![2]!
  await act(async () => {
    handlers.onData?.('First ', true, { messageId: 'answer-0' })
    handlers.onData?.('draft', false, { messageId: 'answer-0' })
  })
  expect(await screen.findByText('First draft')).toBeVisible()
  await act(async () => {
    handlers.onMessageReplace?.({
      answer: 'Final answer',
      task_id: 'task-0',
      id: 'answer-0',
      conversation_id: 'conversation-0',
    })
    await handlers.onCompleted?.()
  })
  expect(await screen.findByText('Final answer')).toBeVisible()
  expect(screen.queryByText('First draft')).not.toBeInTheDocument()
})
it('waits for a local image upload and sends its server id', async () => {
  const upload = createDeferred<{ id: string }>()
  api.upload.mockReturnValue(upload.promise)
  const { user } = setup({
    context: {
      mode: 'completion',
      modelConfig: variableModel(),
      inputs: { question: 'Describe the image' },
    },
    features: { file: fileConfig },
  })
  const file = new File(['image'], 'diagram.png', { type: 'image/png' })
  await user.upload(screen.getByLabelText('common.imageUploader.uploadFromComputer'), file)
  await waitFor(() => expect(api.upload).toHaveBeenCalledTimes(1))
  await run(user)
  expect(await screen.findByText('appDebug.errorMessage.waitForFileUpload')).toBeVisible()
  expect(api.stream).not.toHaveBeenCalled()
  await act(async () => upload.resolve({ id: 'uploaded-image' }))
  await run(user)
  expect(api.stream).toHaveBeenCalledTimes(1)
  expect(api.upload.mock.lastCall![0].data.get('file')).toEqual(file)
  expect(api.stream.mock.lastCall![1].body).toHaveProperty('files', [
    {
      type: 'image',
      transfer_method: TransferMethod.local_file,
      url: '',
      upload_file_id: 'uploaded-image',
    },
  ])
})
it('retains a remote image URL when retrying after a completion error', async () => {
  const { user } = setup({
    context: {
      mode: 'completion',
      modelConfig: variableModel(),
      inputs: { question: 'Describe the image' },
    },
    features: { file: fileConfig },
  })
  await user.click(screen.getByRole('button', { name: 'common.imageUploader.pasteImageLink' }))
  await user.type(
    await screen.findByPlaceholderText('common.imageUploader.pasteImageLinkInputPlaceholder'),
    'https://example.com/diagram.png',
  )
  await user.click(screen.getByRole('button', { name: 'common.operation.ok' }))
  await run(user)
  expect(api.stream.mock.lastCall![1].body).toMatchObject({
    files: [
      {
        type: 'image',
        transfer_method: TransferMethod.remote_url,
        url: 'https://example.com/diagram.png',
      },
    ],
  })
  await act(async () => {
    api.stream.mock.lastCall![2]?.onNotifyError?.('Model unavailable')
    api.stream.mock.lastCall![2]?.onError?.('Model unavailable')
  })
  expect(await screen.findByText('Model unavailable')).toBeVisible()
  expect(screen.getByText('appDebug.noResult')).toBeVisible()
  await run(user)
  expect(api.stream).toHaveBeenCalledTimes(2)
  expect(api.stream.mock.lastCall![1].body).toMatchObject({
    files: [{ url: 'https://example.com/diagram.png' }],
  })
})
it('warns about a missing dataset context variable before starting completion', async () => {
  const { user } = setup({
    context: { mode: 'completion', dataSets: [createDatasetFixture()], hasSetContextVar: false },
  })
  await run(user)
  expect(
    await screen.findByText('appDebug.feature.dataSet.queryVariable.unableToQueryDataSet'),
  ).toBeVisible()
  expect(api.stream).not.toHaveBeenCalled()
  await user.click(
    screen.getByRole('button', { name: 'appDebug.feature.dataSet.queryVariable.ok' }),
  )
  expect(
    screen.queryByText('appDebug.feature.dataSet.queryVariable.unableToQueryDataSet'),
  ).not.toBeInTheDocument()
})
it('prevents duplicate completion requests while a response is pending', async () => {
  const { user } = setup({ context: { mode: 'completion' } })
  await run(user)
  await run(user)
  expect(api.stream).toHaveBeenCalledTimes(1)
  expect(await screen.findByText('appDebug.errorMessage.waitForResponse')).toBeVisible()
  await deliver()
  await run(user)
  expect(api.stream).toHaveBeenCalledTimes(2)
})
it('adds comparison slots up to the four-model limit through the real controls', async () => {
  const { user } = setup({ multiple: true })
  const add = () => screen.getByRole('button', { name: /modelProvider.modelProvider.addModel/ })
  await user.click(add())
  expect(
    screen.getAllByRole('button', { name: /modelProvider.modelProvider.selectModel/ }),
  ).toHaveLength(1)
  await user.click(add())
  expect(
    screen.getAllByRole('button', { name: /modelProvider.modelProvider.selectModel/ }),
  ).toHaveLength(2)
  expect(add()).toBeDisabled()
})
it('disables adding comparison models without run permission', async () => {
  const { user } = setup({ multiple: true, context: { canTestAndRun: false } })
  const add = screen.getByRole('button', { name: /modelProvider.modelProvider.addModel/ })
  expect(add).toBeDisabled()
  await user.click(add)
  expect(screen.getAllByRole('button', { name: 'common.operation.more' })).toHaveLength(2)
})
it('runs completion in both models and opens the selected answer log', async () => {
  const { user } = setup({ multiple: true, context: { mode: 'completion' } })
  await run(user)
  expect(api.stream).toHaveBeenCalledTimes(2)
  await deliver(0, 'First model answer')
  await deliver(1, 'Second model answer')
  expect(screen.getByText('First model answer')).toBeVisible()
  expect(screen.getByText('Second model answer')).toBeVisible()
  await user.click(screen.getAllByRole('button', { name: 'common.operation.log' })[1]!)
  expect(await screen.findByText('Prompt for answer-1')).toBeVisible()
  expect(api.message).toHaveBeenCalledExactlyOnceWith({
    params: { app_id: 'app-1', message_id: 'answer-1' },
  })
  await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
  expect(screen.queryByText('PROMPT LOG')).not.toBeInTheDocument()
  await user.click(screen.getAllByRole('button', { name: 'common.operation.log' })[0]!)
  expect(await screen.findByText('Prompt for answer-0')).toBeVisible()
  expect(screen.queryByText('Prompt for answer-1')).not.toBeInTheDocument()
})
it('refreshes both model conversations from the main panel', async () => {
  const { user } = setup({ multiple: true })
  await sendChat(user)
  await deliver(0, 'First model answer')
  await deliver(1, 'Second model answer')
  await user.click(screen.getByRole('button', { name: 'common.operation.refresh' }))
  expect(screen.queryByText('First model answer')).not.toBeInTheDocument()
  expect(screen.queryByText('Second model answer')).not.toBeInTheDocument()
  await sendChat(user, 'Start over')
  expect(api.stream).toHaveBeenCalledTimes(4)
  for (const request of api.stream.mock.calls.slice(2))
    expect(request[1].body).toMatchObject({ conversation_id: '', parent_message_id: null })
})
it('switches to the selected comparison model and its parameters', async () => {
  const { user, setModel, onCompletionParamsChange } = setup({ multiple: true })
  await user.click(screen.getAllByRole('button', { name: 'common.operation.more' })[0]!)
  await user.click(screen.getByRole('menuitem', { name: 'appDebug.debugAsSingleModel' }))
  expect(setModel).toHaveBeenCalledExactlyOnceWith({
    modelId: 'gpt-4',
    provider: 'openai',
    mode: 'chat',
    features: ['vision'],
  })
  expect(onCompletionParamsChange).toHaveBeenCalledExactlyOnceWith({ temperature: 0.2 })
  expect(
    screen.queryByRole('button', { name: /modelProvider.modelProvider.addModel/ }),
  ).not.toBeInTheDocument()
  await sendChat(user)
  expect(api.stream).toHaveBeenCalledTimes(1)
})
it.each([true, false])(
  'offers image upload only when a comparison model supports vision (%s)',
  (vision) => {
    setup({
      multiple: true,
      context: { mode: 'completion', modelConfig: variableModel() },
      models: vision
        ? comparisonModels
        : comparisonModels.map((model) => ({ ...model, model: 'gpt-3.5-turbo' })),
    })
    if (vision)
      expect(screen.getByLabelText('common.imageUploader.uploadFromComputer')).toBeEnabled()
    else
      expect(
        screen.queryByLabelText('common.imageUploader.uploadFromComputer'),
      ).not.toBeInTheDocument()
  },
)
it('keeps completion logs within their mounted debug session and clears them on remount', async () => {
  const first = setup({ context: { mode: 'completion' } })
  const second = setup({ context: { mode: 'completion' } })
  const secondView = within(second.container)
  await second.user.click(secondView.getByRole('button', { name: 'appDebug.inputs.run' }))
  await deliver()
  await second.user.click(secondView.getByRole('button', { name: 'common.operation.log' }))
  expect(await secondView.findByText('Prompt for answer-0')).toBeVisible()
  expect(within(first.container).queryByText('PROMPT LOG')).not.toBeInTheDocument()
  first.unmount()
  expect(secondView.getByText('Prompt for answer-0')).toBeVisible()
  second.unmount()
  setup({ context: { mode: 'completion' } })
  expect(screen.queryByText('PROMPT LOG')).not.toBeInTheDocument()
})

it('switches between prompt and agent logs for the selected comparison answer and reopens after closing', async () => {
  const normal = {
    ...createMessage('answer-0'),
    conversation_id: 'conversation-0',
    answer: 'Normal answer',
  }
  const agent = {
    ...createMessage('answer-1'),
    answer: 'Agent answer',
    agent_thoughts: [
      {
        id: 'thought-1',
        message_id: 'answer-1',
        tool_labels: {},
        thought: 'Agent reasoning',
        tool: '',
        tool_input: '',
        observation: '',
        position: 0,
        files: [],
      },
    ],
  }
  api.messages.mockImplementation(async ({ query }) => ({
    data: [query.conversation_id === 'conversation-0' ? normal : agent],
    has_more: false,
    limit: 10,
  }))
  api.agentLog.mockResolvedValue({
    iterations: [],
    meta: {
      status: 'succeeded',
      executor: 'Admin',
      start_time: '2024-03-09',
      elapsed_time: 1,
      total_tokens: 15,
      agent_mode: 'function_call',
      iterations: 0,
    },
  })
  const { user } = setup({ multiple: true, context: { mode: 'agent-chat', isAgent: true } })
  await sendChat(user)
  await deliver(0, 'Normal answer')
  await deliver(1, 'Agent answer')
  const logButtons = screen.getAllByRole('button', { name: 'common.operation.log' })
  await user.click(logButtons[0]!)
  expect(await screen.findByText('Prompt for answer-0')).toBeVisible()
  await user.click(logButtons[1]!)
  expect(
    await screen.findByRole('heading', { name: 'appLog.runDetail.workflowTitle' }),
  ).toBeVisible()
  expect(await screen.findByText('Admin')).toBeVisible()
  expect(api.agentLog).toHaveBeenCalledExactlyOnceWith({
    params: { app_id: 'app-1' },
    query: { conversation_id: 'conversation-1', message_id: 'answer-1' },
  })
  expect(screen.queryByText('PROMPT LOG')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
  expect(
    screen.queryByRole('heading', { name: 'appLog.runDetail.workflowTitle' }),
  ).not.toBeInTheDocument()
  await user.click(logButtons[0]!)
  expect(await screen.findByText('Prompt for answer-0')).toBeVisible()
})
