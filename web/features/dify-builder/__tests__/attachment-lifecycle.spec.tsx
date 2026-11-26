import type { SessionRunEvents } from '../session/types'
import type { SessionView } from '../types'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider } from 'jotai'
import { useHydrateAtoms } from 'jotai/utils'
import { useMemo } from 'react'
import { useFileStore } from '@/app/components/base/file-uploader/store'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createDifyBuilderRuntime } from '@/test/fixtures/dify-builder'
import { createFileUploadConfigFixture } from '@/test/fixtures/file-upload-config'
import DifyBuilderComposer from '../composer'
import { DifyBuilderAttachmentScope } from '../composer/attachment-scope'
import { useDifyBuilderAttachmentDraft } from '../composer/use-attachment-draft'
import {
  commandStartedEvent,
  conversationPage,
  createControlledEventStream,
  createSessionView,
  stateEvent,
  streamOf,
  useScriptedSessionTransport,
} from '../session/__tests__/fixtures'
import { useDifyBuilderSessionController } from '../session/use-session-controller'
import { difyBuilderRuntimeAtom } from '../state'

const api = vi.hoisted(() => ({
  create: vi.fn(),
  message: vi.fn(),
  get: vi.fn(),
  conversation: vi.fn(),
}))
vi.mock('@/service/console', async (importOriginal) => ({
  consoleQuery: (await importOriginal<typeof import('@/service/console')>()).consoleQuery,
  consoleClient: {
    difyBuilder: {
      sessions: {
        post: api.create,
        bySessionId: {
          get: api.get,
          conversation: { get: api.conversation },
          messages: { post: api.message },
        },
      },
    },
  },
}))
vi.mock('@/next/navigation', () => ({
  useParams: () => ({}),
  usePathname: () => '/app/app-1/workflow',
}))
vi.mock('../model/selector', () => ({
  default: () => <button type="button">Model selector</button>,
}))
vi.mock('../model/use-model', () => ({
  useDifyBuilderModel: () => ({
    model: { completion_params: {}, mode: 'chat', name: 'gpt-4o', provider: 'openai' },
    modelList: [],
    isLoading: false,
    isError: false,
    hasAvailableModels: true,
    retry: vi.fn(),
  }),
}))

const file = (id: string): FileEntity => ({
  id,
  name: `${id}.txt`,
  uploadedId: id,
  size: 20,
  type: 'text/plain',
  progress: 100,
  transferMethod: 'local_file',
  supportFileType: 'document',
})
const FilePicker = () => {
  const store = useFileStore()
  return (
    <>
      {['first', 'second'].map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => store.getState().setFiles([...store.getState().files, file(id)])}
        >
          {`Select ${id} file`}
        </button>
      ))}
    </>
  )
}
const SessionOwner = ({ edit }: { edit: boolean }) => {
  useScriptedSessionTransport()
  const attachmentDraft = useDifyBuilderAttachmentDraft()
  const events = useMemo<SessionRunEvents>(
    () => ({
      ...attachmentDraft,
      onWorkflowEvent: vi.fn(),
      onStreamInterrupted: vi.fn(),
      onCanvasEvent: vi.fn(),
      restoreRun: vi.fn(),
      finishCommand: vi.fn(),
      reset: vi.fn(),
      onCanvasRefreshed: vi.fn(),
    }),
    [attachmentDraft],
  )
  const session = useDifyBuilderSessionController(undefined, events)
  useHydrateAtoms([
    [
      difyBuilderRuntimeAtom,
      createDifyBuilderRuntime({
        session,
        fileUploadConfig: createFileUploadConfigFixture(),
        getCanvasSnapshot: () => ({
          nodes: [],
          edges: edit ? [{ source: 'start', target: 'end' }] : [],
          isChatflow: false,
        }),
      }),
    ],
  ] as const)
  return (
    <>
      <FilePicker />
      <button type="button" onClick={() => void session.restore('session-1')}>
        Restore session
      </button>
      <button type="button" onClick={() => void session.refresh()}>
        Refresh session
      </button>
      <button type="button" onClick={session.reset}>
        Reset session
      </button>
      <DifyBuilderComposer />
    </>
  )
}
const renderSession = (edit = false) =>
  renderWithConsoleQuery(
    <Provider store={createStore()}>
      <DifyBuilderAttachmentScope>
        <SessionOwner edit={edit} />
      </DifyBuilderAttachmentScope>
    </Provider>,
  )
const sendButton = () => screen.getByRole('button', { name: 'difyBuilder.messageSend' })
const prompt = () => screen.getByRole('textbox', { name: 'difyBuilder.messagePlaceholder' })
const materialView = (turnId: string, uploadId = 'first'): SessionView =>
  createSessionView({
    version: 4,
    run_status: 'waiting_input',
    canvas_read_only: false,
    attachments: [
      {
        id: 'material-1',
        app_id: 'app-1',
        session_id: 'session-1',
        task_id: 'session-1:0',
        generation: 0,
        seq: 1,
        client_turn_id: turnId,
        consumed_version: 4,
        status: 'consumed',
        test_input_candidate: false,
        attachments: [
          {
            upload_file_id: uploadId,
            name: `${uploadId}.txt`,
            extension: 'txt',
            size: 20,
            status: 'consumed',
          },
        ],
      },
    ],
  })

beforeEach(() => {
  vi.resetAllMocks()
  api.conversation.mockResolvedValue(conversationPage())
})

it.each([
  { scenario: 'build', edit: false },
  { scenario: 'edit', edit: true },
])(
  'removes admitted files immediately and allows new attachments only after the $scenario stream settles',
  async ({ edit }) => {
    const user = userEvent.setup()
    const response = createControlledEventStream()
    api.create.mockResolvedValue(response.iterable)
    api.message.mockImplementation(async ({ body }) =>
      streamOf(
        stateEvent(materialView(body.client_turn_id, body.attachments[0].upload_file_id), {
          command_id: '',
        }),
      ),
    )
    renderSession(edit)
    await user.click(screen.getByRole('button', { name: 'Select first file' }))
    await user.type(prompt(), 'Build using the first file')
    await user.click(sendButton())
    await waitFor(() => expect(api.create).toHaveBeenCalledOnce())
    expect(api.create.mock.calls[0]![0].body).toMatchObject({
      scenario: edit ? 'edit' : 'build',
      attachments: [{ upload_file_id: 'first' }],
    })
    await act(async () => response.push(commandStartedEvent(createSessionView())))
    await waitFor(() => expect(screen.queryByText('first.txt')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'difyBuilder.taskControl.stop' })).toBeEnabled()
    expect(prompt()).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'common.fileUploader.uploadFromComputer' }),
    ).toBeDisabled()
    expect(api.message).not.toHaveBeenCalled()
    expect(api.create.mock.calls[0]![1].signal.aborted).toBe(false)
    await act(async () => {
      response.push(stateEvent(createSessionView({ version: 5, run_status: 'waiting_input' })))
      response.close()
    })
    await waitFor(() => expect(prompt()).toBeEnabled())
    expect(
      screen.getByRole('button', { name: 'common.fileUploader.uploadFromComputer' }),
    ).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Select second file' }))
    await user.click(sendButton())
    expect(api.message.mock.calls[0]![0].body.attachments).toEqual([{ upload_file_id: 'second' }])
  },
)

it('retains the initial files and text when session admission fails', async () => {
  const user = userEvent.setup()
  api.create.mockRejectedValue(Object.assign(new Error('Rejected'), { status: 409 }))
  renderSession()
  await user.click(screen.getByRole('button', { name: 'Select first file' }))
  await user.type(prompt(), 'Keep this request')
  await user.click(sendButton())
  await waitFor(() => expect(api.create).toHaveBeenCalledOnce())
  await waitFor(() => expect(prompt()).toHaveValue('Keep this request'))
  expect(screen.getByText('first.txt')).toBeVisible()
  expect(sendButton()).toBeEnabled()
})

it.each(['paused', 'abandoned'] as const)(
  'blocks file submission for a %s task while retaining removable files',
  async (taskStatus) => {
    const user = userEvent.setup()
    api.get.mockResolvedValue(
      createSessionView({
        version: 4,
        run_status: 'paused',
        task_status: taskStatus,
        canvas_read_only: false,
      }),
    )
    renderSession()
    await user.click(screen.getByRole('button', { name: 'Select first file' }))
    await user.click(screen.getByRole('button', { name: 'Restore session' }))
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        `difyBuilder.attachments.${taskStatus === 'paused' ? 'paused' : 'abandoned'}`,
      ),
    )
    if (taskStatus === 'abandoned') await user.type(prompt(), 'Next task')
    expect(sendButton()).toBeDisabled()
    expect(screen.getByText('first.txt')).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'common.fileUploader.uploadFromComputer' }),
    ).toBeDisabled()
    expect(api.message).not.toHaveBeenCalled()
    if (taskStatus === 'paused')
      expect(screen.getByRole('button', { name: 'difyBuilder.taskControl.resume' })).toBeEnabled()
  },
)

it.each([true, false])(
  'clears unknown file delivery only for its matching receipt: %s',
  async (matches) => {
    const user = userEvent.setup()
    api.get.mockResolvedValue(
      createSessionView({ version: 4, run_status: 'waiting_input', canvas_read_only: false }),
    )
    api.message.mockRejectedValue(new TypeError('Response lost'))
    renderSession()
    await user.click(screen.getByRole('button', { name: 'Restore session' }))
    await waitFor(() => expect(prompt()).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Select first file' }))
    await user.type(prompt(), 'Material context')
    await user.click(sendButton())
    await waitFor(() => expect(prompt()).toHaveValue('Material context'))
    expect(sendButton()).toBeDisabled()
    const turnId = api.message.mock.calls[0]![0].body.client_turn_id
    api.get.mockResolvedValue(materialView(matches ? turnId : 'different-turn'))
    await user.click(screen.getByRole('button', { name: 'Refresh session' }))
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2))
    if (matches) {
      await waitFor(() => expect(screen.queryByText('first.txt')).not.toBeInTheDocument())
      expect(prompt()).toHaveValue('')
    } else {
      expect(screen.getByText('first.txt')).toBeVisible()
      expect(sendButton()).toBeDisabled()
    }
    expect(api.message).toHaveBeenCalledOnce()
  },
)

it('clears the file draft when the session is explicitly reset', async () => {
  const user = userEvent.setup()
  renderSession()
  await user.click(screen.getByRole('button', { name: 'Select first file' }))
  await user.click(screen.getByRole('button', { name: 'Reset session' }))
  expect(screen.queryByText('first.txt')).not.toBeInTheDocument()
})

it('does not restore pending files or text after an authoritative conversation clear', async () => {
  const user = userEvent.setup()
  const material = createControlledEventStream()
  api.get.mockResolvedValue(
    createSessionView({ version: 4, run_status: 'waiting_input', canvas_read_only: false }),
  )
  api.message.mockResolvedValue(material.iterable)
  renderSession()
  await user.click(screen.getByRole('button', { name: 'Restore session' }))
  await waitFor(() => expect(prompt()).toBeEnabled())
  await user.click(screen.getByRole('button', { name: 'Select first file' }))
  await user.type(prompt(), 'Supplement')
  await user.click(sendButton())
  await waitFor(() => expect(api.message).toHaveBeenCalledOnce())
  api.get.mockResolvedValue(
    createSessionView({
      version: 5,
      conversation_cleared: true,
      lifecycle_settlement: 'pending',
      run_status: 'complete',
      task_status: 'abandoned',
    }),
  )
  await user.click(screen.getByRole('button', { name: 'Refresh session' }))
  await waitFor(() => expect(api.message.mock.calls[0]![1].signal.aborted).toBe(true))
  await act(async () => {
    material.close()
  })
  expect(screen.queryByText('first.txt')).not.toBeInTheDocument()
  expect(prompt()).toHaveValue('')
  expect(api.message).toHaveBeenCalledOnce()
})
