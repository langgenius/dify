import type { DebugWithSingleModelRefType } from '../index'
import type { Features } from '@/app/components/base/features/types'
import type { consoleClient } from '@/service/console'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
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
import { renderWithConsoleQuery } from '@/test/console/query-data'
import {
  createDebugConfigurationFixture,
  createModelConfigFixture,
} from '@/test/fixtures/debug-configuration'
import { createFileUploadConfigFixture } from '@/test/fixtures/file-upload-config'
import { ModelModeType, TransferMethod } from '@/types/app'
import DebugWithSingleModel from '../index'

const api = vi.hoisted(() => ({
  stream: vi.fn<typeof import('@/service/base').ssePost>(),
  upload: vi.fn<typeof import('@/service/base').upload>(),
  messages: vi.fn<typeof consoleClient.apps.byAppId.chatMessages.get>(),
  suggestions:
    vi.fn<typeof consoleClient.apps.byAppId.chatMessages.byMessageId.suggestedQuestions.get>(),
  stop: vi.fn<typeof consoleClient.apps.byAppId.chatMessages.byTaskId.stop.post>(),
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
      'apps.byAppId.chatMessages.byTaskId.stop.post': (input) => api.stop(input),
    }),
  }
})
vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useParams: () => ({ appId: 'test-app-id' }),
  usePathname: () => '/app/test-app-id/configuration',
}))

const onOpenFeatures = vi.fn()
const onOpenLog = vi.fn()
function setup({
  context = {},
  features = {},
  checkCanSend,
}: {
  context?: Parameters<typeof createDebugConfigurationFixture>[0]
  features?: Features
  checkCanSend?: () => boolean
} = {}) {
  const ref = createRef<DebugWithSingleModelRefType>()
  const config = createDebugConfigurationFixture({
    readonly: false,
    canTestAndRun: true,
    appId: 'test-app-id',
    onOpenFeatures,
    inputs: { var1: 'test input' },
    completionParams: { max_tokens: 100, temperature: 0.7 },
    modelConfig: createModelConfigFixture({
      provider: 'openai',
      model_id: 'gpt-3.5-turbo',
      mode: ModelModeType.chat,
      configs: {
        prompt_template: 'Test template',
        prompt_variables: [{ key: 'var1', name: 'Variable 1', type: 'string', required: false }],
      },
    }),
    ...context,
  })
  renderWithConsoleQuery(
    // oxlint-disable-next-line eslint-react/no-context-provider -- use-context-selector requires its own Provider rather than React's context shorthand.
    <ConfigContext.Provider value={config}>
      <FeaturesProvider features={{ ...createFeaturesStore().getState().features, ...features }}>
        <EventEmitterContextProvider>
          <button type="button" onClick={() => ref.current?.handleRestart()}>
            Restart debug conversation
          </button>
          <DebugWithSingleModel
            ref={ref}
            onOpenLog={onOpenLog}
            chatContainerRef={createRef<HTMLDivElement>()}
            checkCanSend={checkCanSend}
          />
          <AppToaster manager={appConfigurationToastManager} />
          <AppToaster />
        </EventEmitterContextProvider>
      </FeaturesProvider>
    </ConfigContext.Provider>,
  )
  return userEvent.setup()
}

async function send(user: ReturnType<typeof userEvent.setup>, query = 'Test question') {
  await user.type(screen.getByRole('textbox'), query)
  await user.click(screen.getByRole('button', { name: 'common.operation.send' }))
}
async function deliverAnswer(answer = 'Streamed answer') {
  const callbacks = api.stream.mock.lastCall![2]!
  await act(async () => {
    callbacks.onData?.(answer, true, {
      messageId: 'answer-1',
      conversationId: 'conversation-1',
      taskId: 'task-1',
    })
  })
  return callbacks
}

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset()
  onOpenFeatures.mockClear()
  onOpenLog.mockClear()
  api.stream.mockResolvedValue(undefined)
  api.messages.mockResolvedValue({ data: [], has_more: false, limit: 10 })
  api.suggestions.mockResolvedValue({ data: [] })
  api.stop.mockResolvedValue({ result: 'success' })
  api.upload.mockResolvedValue({ id: 'uploaded-file-1' })
})
afterEach(() => {
  toast.dismiss()
  configurationToast.dismiss()
})

it('sends the configured prompt and inputs, renders the stream, and exposes the answer log', async () => {
  const user = setup()
  await send(user)
  expect(api.stream).toHaveBeenCalledTimes(1)
  expect(api.stream.mock.lastCall![0]).toBe('apps/test-app-id/chat-messages')
  expect(api.stream.mock.lastCall![1].body).toMatchObject({
    query: 'Test question',
    inputs: { var1: 'test input' },
    parent_message_id: null,
    model_config: {
      pre_prompt: 'Test template',
      model: {
        provider: 'openai',
        name: 'gpt-3.5-turbo',
        completion_params: { max_tokens: 100, temperature: 0.7 },
      },
    },
  })
  const callbacks = await deliverAnswer()
  expect(await screen.findByText('Streamed answer')).toBeVisible()
  await act(async () => {
    await callbacks.onCompleted?.()
  })
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'appDebug.operation.stopResponding' }),
    ).not.toBeInTheDocument(),
  )
  await user.click(screen.getByRole('button', { name: 'common.operation.log' }))
  expect(onOpenLog).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'answer-1', content: 'Streamed answer' }),
  )
})

it('shows a transport error through the configuration toast host', async () => {
  const user = setup()
  await send(user)
  await act(async () => {
    api.stream.mock.lastCall![2]!.onNotifyError?.('Base model not found')
  })
  expect(await screen.findByText('Base model not found')).toBeVisible()
})

it('does not start a request when the parent validation rejects it', async () => {
  const checkCanSend = vi.fn(() => false)
  const user = setup({ checkCanSend })
  await send(user)
  expect(checkCanSend).toHaveBeenCalledTimes(1)
  expect(api.stream).not.toHaveBeenCalled()
  expect(
    screen.queryByRole('button', { name: 'appDebug.operation.stopResponding' }),
  ).not.toBeInTheDocument()
})

it('opens feature configuration through the real feature bar', async () => {
  const user = setup()
  await user.click(screen.getByRole('button', { name: 'appDebug.feature.bar.empty' }))
  expect(onOpenFeatures).toHaveBeenCalledExactlyOnceWith(true)
})

it('allows test runs with read-only configuration but hides annotation management and disables feature editing', async () => {
  const user = setup({ context: { readonly: true, canTestAndRun: true } })
  expect(screen.getByRole('textbox')).not.toBeDisabled()
  expect(screen.getByRole('button', { name: 'appDebug.feature.bar.empty' })).toBeDisabled()
  await send(user)
  const callbacks = await deliverAnswer()
  await act(async () => {
    await callbacks.onCompleted?.()
  })
  expect(await screen.findByText('Streamed answer')).toBeVisible()
  expect(
    screen.queryByRole('button', { name: 'appDebug.feature.annotation.add' }),
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'appDebug.feature.annotation.edit' }),
  ).not.toBeInTheDocument()
  expect(api.stream).toHaveBeenCalledTimes(1)
})

it('disables the composer without test/run permission while keeping configuration editable', async () => {
  const user = setup({ context: { readonly: false, canTestAndRun: false } })
  expect(screen.getByRole('textbox')).toBeDisabled()
  expect(screen.getByRole('button', { name: 'common.operation.send' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'appDebug.feature.bar.empty' }))
  expect(onOpenFeatures).toHaveBeenCalledExactlyOnceWith(true)
  expect(api.stream).not.toHaveBeenCalled()
})

it.each([true, false])(
  'uses the enabled state of opening features in the chat and request (%s)',
  async (enabled) => {
    const user = setup({
      features: {
        opening: { enabled, opening_statement: 'Hello!', suggested_questions: ['First question'] },
      },
    })
    if (enabled) expect(await screen.findByText('Hello!')).toBeVisible()
    else expect(screen.queryByText('Hello!')).not.toBeInTheDocument()
    await send(user)
    expect(api.stream.mock.lastCall![1].body).toMatchObject({
      model_config: {
        opening_statement: enabled ? 'Hello!' : '',
        suggested_questions: enabled ? ['First question'] : [],
      },
    })
  },
)

it('stops the current task through the real stop control', async () => {
  const user = setup()
  await send(user)
  await deliverAnswer()
  await user.click(screen.getByRole('button', { name: 'appDebug.operation.stopResponding' }))
  await waitFor(() =>
    expect(api.stop).toHaveBeenCalledExactlyOnceWith({
      params: { app_id: 'test-app-id', task_id: 'task-1' },
    }),
  )
  expect(
    screen.queryByRole('button', { name: 'appDebug.operation.stopResponding' }),
  ).not.toBeInTheDocument()
  expect(screen.getByText('Streamed answer')).toBeVisible()
})

it('restarts through the parent ref and sends the next message without the previous conversation', async () => {
  const user = setup()
  await send(user)
  await deliverAnswer()
  await user.click(screen.getByRole('button', { name: 'Restart debug conversation' }))
  expect(screen.queryByText('Streamed answer')).not.toBeInTheDocument()
  expect(screen.queryByText('Test question')).not.toBeInTheDocument()
  await send(user, 'New conversation')
  expect(api.stream).toHaveBeenCalledTimes(2)
  expect(api.stream.mock.lastCall![1].body).toMatchObject({
    query: 'New conversation',
    parent_message_id: null,
  })
  expect(api.stream.mock.lastCall![1].body).not.toHaveProperty('conversation_id', 'conversation-1')
})

it.each([
  ['test.pdf', 'application/pdf', 'document'],
  ['test.png', 'image/png', 'image'],
] as const)('sends the uploaded %s attachment using its server id', async (name, mime, type) => {
  const user = setup({
    features: {
      file: {
        enabled: true,
        allowed_file_types: ['document', 'image'],
        allowed_file_upload_methods: [TransferMethod.local_file],
        allowed_file_extensions: [],
        number_limits: 3,
        fileUploadConfig: createFileUploadConfigFixture(),
      },
    },
  })
  const file = new File(['attachment'], name, { type: mime })
  fireEvent.drop(screen.getByRole('textbox'), { dataTransfer: { files: [file] } })
  await waitFor(() => expect(api.upload).toHaveBeenCalledTimes(1))
  expect(api.upload.mock.lastCall![0].data.get('file')).toEqual(file)
  await send(user, 'Read the attachment')
  expect(api.stream.mock.lastCall![1].body).toHaveProperty('files', [
    {
      type,
      transfer_method: TransferMethod.local_file,
      url: '',
      upload_file_id: 'uploaded-file-1',
    },
  ])
})
