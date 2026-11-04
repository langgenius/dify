import type { ReactNode } from 'react'
import type { ModelAndParameter } from '../../types'
import type { IChatItem } from '@/app/components/base/chat/chat/type'
import type { VisionFile } from '@/types/app'
import { zProviderWithModelsResponse } from '@dify/contracts/api/console/workspaces/zod.gen'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FeaturesProvider } from '@/app/components/base/features/context'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import DebugConfigurationContext from '@/context/debug-configuration'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { PromptMode } from '@/models/debug'
import { consoleQuery } from '@/service/console'
import { createCatalogModelFixture, createModelCatalogFixture } from '@/test/console/model-provider'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import {
  createDebugConfigurationFixture,
  createModelConfigFixture,
} from '@/test/fixtures/debug-configuration'
import { TransferMethod } from '@/types/app'
import { APP_CHAT_WITH_MULTIPLE_MODEL } from '../../types'
import { DebugWithMultipleModelContextProvider } from '../context-provider'
import TextGenerationItem from '../text-generation-item'

const requests = vi.hoisted(() => ({
  // oxlint-disable-next-line typescript/no-deprecated -- The existing completion owner uses SSE; retain its typed streaming transport boundary.
  stream: vi.fn<typeof import('@/service/base').ssePost>(),
  log: vi.fn(),
  notifyError: vi.fn(),
}))

vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  ssePost: requests.stream,
}))
vi.mock('@/service/debug', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/debug')>()),
  fetchTextGenerationMessage: requests.log,
}))
vi.mock('@/app/components/app/configuration/toast', () => ({
  toast: { error: requests.notifyError },
}))
vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useParams: () => ({ appId: 'app-123' }),
}))

const model: ModelAndParameter = {
  id: 'model-1',
  model: 'gpt-4',
  provider: 'openai',
  parameters: { temperature: 0.7 },
}
const localFile: VisionFile = {
  id: 'f1',
  type: 'image',
  transfer_method: TransferMethod.local_file,
  url: 'blob:123',
  upload_file_id: 'upload-1',
}
const remoteFile: VisionFile = {
  id: 'f2',
  type: 'image',
  transfer_method: TransferMethod.remote_url,
  url: 'https://example.com/file.png',
  upload_file_id: '',
}
const DebugProvider = DebugConfigurationContext.Provider

function renderItem({
  configuration = createDebugConfigurationFixture({
    appId: 'app-123',
    mode: 'completion',
    inputs: { name: 'World' },
  }),
  fileEnabled = true,
  onOpenLog = (_item: IChatItem) => {},
}: {
  configuration?: ReturnType<typeof createDebugConfigurationFixture>
  fileEnabled?: boolean
  onOpenLog?: (item: IChatItem) => void
} = {}) {
  let emit!: NonNullable<ReturnType<typeof useEventEmitterContextContext>['eventEmitter']>['emit']
  function EventSource({ children }: { children: ReactNode }) {
    const { eventEmitter } = useEventEmitterContextContext()
    emit = (event) => eventEmitter!.emit(event)
    return children
  }
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(
    consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryKey({
      input: { params: { model_type: ModelTypeEnum.textGeneration } },
    }),
    {
      data: [
        zProviderWithModelsResponse.parse(
          createModelCatalogFixture({
            models: [createCatalogModelFixture({ model_properties: { mode: 'chat' } })],
          }),
        ),
      ],
    },
  )
  renderWithConsoleQuery(
    <DebugProvider value={configuration}>
      <FeaturesProvider
        features={{
          file: { enabled: fileEnabled },
          moreLikeThis: { enabled: false },
          moderation: { enabled: false },
          text2speech: { enabled: false },
        }}
      >
        <EventEmitterContextProvider>
          <EventSource>
            <DebugWithMultipleModelContextProvider
              multipleModelConfigs={[model]}
              onMultipleModelConfigsChange={() => {}}
              onDebugWithMultipleModelChange={() => {}}
              onOpenLog={onOpenLog}
            >
              <TextGenerationItem modelAndParameter={model} />
            </DebugWithMultipleModelContextProvider>
          </EventSource>
        </EventEmitterContextProvider>
      </FeaturesProvider>
    </DebugProvider>,
    { queryClient },
  )
  return {
    send: (files: VisionFile[] = [], type = APP_CHAT_WITH_MULTIPLE_MODEL) => {
      act(() => emit({ type, payload: { message: 'Generate', files } }))
    },
  }
}

function streamCallbacks() {
  expect(requests.stream).toHaveBeenCalledTimes(1)
  return requests.stream.mock.calls[0]![2]!
}

function requestBody() {
  expect(requests.stream).toHaveBeenCalledTimes(1)
  expect(requests.stream.mock.calls[0]![0]).toBe('apps/app-123/completion-messages')
  return requests.stream.mock.calls[0]![1].body
}

describe('TextGenerationItem', () => {
  it('shows loading, streams the result and opens its log through the debug session', async () => {
    const user = userEvent.setup()
    const onOpenLog = vi.fn()
    requests.log.mockResolvedValue({ id: 'msg-123', answer: 'Generated text', message: [] })
    const { send } = renderItem({ onOpenLog })

    send()
    expect(screen.getByLabelText('common.loading')).toBeInTheDocument()
    const stream = streamCallbacks()
    act(() =>
      stream.onData?.('Generated text', true, {
        messageId: 'msg-123',
        conversationId: '',
        taskId: '',
      }),
    )

    expect(await screen.findByText('Generated text')).toBeVisible()
    expect(screen.queryByLabelText('common.loading')).not.toBeInTheDocument()
    act(() => stream.onCompleted?.())
    await user.click(screen.getByRole('button', { name: 'common.operation.log' }))

    await waitFor(() =>
      expect(onOpenLog).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'msg-123',
          content: 'Generated text',
          isAnswer: true,
        }),
      ),
    )
    expect(requests.log).toHaveBeenCalledWith({ appId: 'app-123', messageId: 'msg-123' })
  })

  it('sends the configured prompt, input schema, model and datasets to the completion service', () => {
    const configuration = createDebugConfigurationFixture({
      appId: 'app-123',
      mode: 'completion',
      inputs: { name: 'World', age: '42' },
      modelConfig: createModelConfigFixture({
        configs: {
          prompt_template: 'Hello {{name}}',
          prompt_variables: [
            { key: 'name', name: 'Name', type: 'string', required: true },
            { key: 'age', name: 'Age', type: 'number', required: true },
            { key: 'context', name: 'Context', type: 'string', is_context_var: true },
          ],
        },
      }),
      dataSets: [createDatasetFixture({ id: 'ds-1' }), createDatasetFixture({ id: 'ds-2' })],
    })
    const { send } = renderItem({ configuration })
    send([localFile, remoteFile])

    expect(requestBody()).toMatchObject({
      response_mode: 'streaming',
      inputs: { name: 'World', age: '42' },
      model_config: {
        pre_prompt: 'Hello {{name}}',
        prompt_type: 'simple',
        dataset_query_variable: 'context',
        model: {
          provider: 'openai',
          name: 'gpt-4',
          mode: 'chat',
          completion_params: { temperature: 0.7 },
        },
        file_upload: { enabled: true },
        dataset_configs: {
          datasets: {
            datasets: [
              { dataset: { enabled: true, id: 'ds-1' } },
              { dataset: { enabled: true, id: 'ds-2' } },
            ],
          },
        },
        user_input_form: expect.arrayContaining([
          {
            'text-input': expect.objectContaining({
              variable: 'name',
              label: 'Name',
              required: true,
            }),
          },
          { number: expect.objectContaining({ variable: 'age', label: 'Age', required: true }) },
        ]),
      },
      files: [
        { id: 'f1', transfer_method: TransferMethod.local_file, url: '' },
        {
          id: 'f2',
          transfer_method: TransferMethod.remote_url,
          url: 'https://example.com/file.png',
        },
      ],
    })
  })

  it('sends advanced prompts instead of the simple template', () => {
    const configuration = createDebugConfigurationFixture({
      appId: 'app-123',
      mode: 'completion',
      isAdvancedMode: true,
      promptMode: PromptMode.advanced,
      modelConfig: createModelConfigFixture({
        configs: { prompt_template: 'Unused template', prompt_variables: [] },
      }),
      chatPromptConfig: { prompt: [{ role: 'system', text: 'Advanced chat prompt' }] },
      completionPromptConfig: {
        ...createDebugConfigurationFixture().completionPromptConfig,
        prompt: { role: 'system', text: 'Advanced completion prompt' },
      },
    })
    const { send } = renderItem({ configuration })
    send()
    expect(requestBody()).toMatchObject({
      model_config: {
        pre_prompt: '',
        prompt_type: 'advanced',
        chat_prompt_config: configuration.chatPromptConfig,
        completion_prompt_config: configuration.completionPromptConfig,
      },
    })
  })

  it.each([
    {
      name: 'uploads are disabled',
      fileEnabled: false,
      files: [localFile],
    },
    { name: 'no files are selected', fileEnabled: true, files: [] },
  ])('omits attachments when $name', ({ fileEnabled, files }) => {
    const { send } = renderItem({ fileEnabled })
    send(files)
    expect(requestBody()).not.toHaveProperty('files')
  })

  it('ignores unrelated events', () => {
    const { send } = renderItem()
    send([], 'OTHER_EVENT')
    expect(requests.stream).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('common.loading')).not.toBeInTheDocument()
  })

  it('reports service notification errors', () => {
    const { send } = renderItem()
    send()
    act(() => streamCallbacks().onNotifyError?.('Base model not found'))
    expect(requests.notifyError).toHaveBeenCalledWith('Base model not found')
  })
})
