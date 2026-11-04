import type { SessionView } from '../../types'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider } from 'jotai'
import { useFileStore } from '@/app/components/base/file-uploader/store'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createDifyBuilderRuntime } from '@/test/fixtures/dify-builder'
import { createFileUploadConfigFixture } from '@/test/fixtures/file-upload-config'
import DifyBuilderComposer from '..'
import { createSessionView } from '../../session/__tests__/fixtures'
import { difyBuilderSessionBusyAtom, difyBuilderSessionViewAtom } from '../../session/state'
import { difyBuilderDraftAtom, difyBuilderRuntimeAtom } from '../../state'
import { DifyBuilderAttachmentScope } from '../attachment-scope'

vi.mock('@/next/navigation', () => ({
  useParams: () => ({}),
  usePathname: () => '/app/app-1/workflow',
}))
vi.mock('../../model/selector', () => ({
  default: () => <button type="button">Model selector</button>,
}))
vi.mock('../../model/use-model', () => ({
  useDifyBuilderModel: () => ({
    model: { completion_params: {}, mode: 'chat', name: 'gpt-4o', provider: 'openai' },
    modelList: [],
    isLoading: false,
    isError: false,
    hasAvailableModels: true,
    retry: vi.fn(),
  }),
}))

const uploadedFile: FileEntity = {
  id: 'draft-file',
  name: 'rules.txt',
  size: 20,
  type: 'text/plain',
  progress: 100,
  transferMethod: 'local_file',
  supportFileType: 'document',
  uploadedId: 'upload-1',
}
const SeedFiles = ({ files }: { files: FileEntity[] }) => {
  const store = useFileStore()
  return (
    <button type="button" onClick={() => store.getState().setFiles(files)}>
      Select fixture files
    </button>
  )
}
const renderComposer = (
  files: FileEntity[],
  {
    attachmentsOnly = false,
    view = createSessionView({ run_status: 'waiting_input' }),
    busy = false,
  }: { attachmentsOnly?: boolean; view?: SessionView; busy?: boolean } = {},
) => {
  const store = createStore()
  const runtime = createDifyBuilderRuntime({ fileUploadConfig: createFileUploadConfigFixture() })
  store.set(difyBuilderRuntimeAtom, runtime)
  store.set(difyBuilderSessionViewAtom, view)
  store.set(difyBuilderSessionBusyAtom, busy)
  store.set(difyBuilderDraftAtom, 'Keep this context')
  renderWithConsoleQuery(
    <Provider store={store}>
      <DifyBuilderAttachmentScope>
        <SeedFiles files={files} />
        <DifyBuilderComposer attachmentsOnly={attachmentsOnly} />
      </DifyBuilderAttachmentScope>
    </Provider>,
  )
  return { store, runtime }
}

it('preserves files and text after failure and clears accepted files when input is available', async () => {
  const user = userEvent.setup()
  const { store, runtime } = renderComposer([uploadedFile])
  runtime.session.sendMessage = vi.fn(async () => false)
  await user.click(screen.getByRole('button', { name: 'Select fixture files' }))
  expect(screen.getByText('rules.txt')).toBeVisible()
  expect(
    screen.getByRole('button', { name: 'common.fileUploader.uploadFromComputer' }),
  ).toBeEnabled()
  await user.click(screen.getByRole('button', { name: 'difyBuilder.messageSend' }))
  expect(runtime.session.sendMessage).toHaveBeenCalledExactlyOnceWith(
    'Keep this context',
    undefined,
    [{ upload_file_id: 'upload-1' }],
  )
  expect(store.get(difyBuilderDraftAtom)).toBe('Keep this context')
  expect(screen.getByText('rules.txt')).toBeVisible()
  runtime.session.sendMessage = vi.fn(async () => true)
  await user.click(screen.getByRole('button', { name: 'difyBuilder.messageSend' }))
  await waitFor(() => expect(screen.queryByText('rules.txt')).not.toBeInTheDocument())
})

it.each([50, -1])('blocks sending a native file at progress %s', async (progress) => {
  const user = userEvent.setup()
  const { runtime } = renderComposer([{ ...uploadedFile, progress, uploadedId: undefined }])
  await user.click(screen.getByRole('button', { name: 'Select fixture files' }))
  expect(screen.getByRole('button', { name: 'difyBuilder.messageSend' })).toBeDisabled()
  expect(runtime.session.sendMessage).not.toHaveBeenCalled()
})

it.each([false, true])(
  'disables uploads and text while running, including an existing file draft: %s',
  async (hasFiles) => {
    const user = userEvent.setup()
    const { runtime } = renderComposer(hasFiles ? [uploadedFile] : [], {
      view: createSessionView({ run_status: 'processing' }),
      busy: true,
    })
    await user.click(screen.getByRole('button', { name: 'Select fixture files' }))
    const upload = screen.getByRole('button', { name: 'common.fileUploader.uploadFromComputer' })
    expect(upload).toBeDisabled()
    expect(screen.getByRole('textbox')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'difyBuilder.taskControl.stop' })).toBeEnabled()
    await user.click(upload)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    if (hasFiles) {
      expect(screen.getByText('rules.txt')).toBeVisible()
      const send = screen.getByRole('button', { name: 'difyBuilder.messageSend' })
      expect(send).toBeDisabled()
      await user.click(send)
    }
    expect(runtime.session.sendMessage).not.toHaveBeenCalled()
  },
)

it('disables retrying a failed upload while running', async () => {
  const user = userEvent.setup()
  renderComposer([{ ...uploadedFile, progress: -1, uploadedId: undefined }], {
    view: createSessionView({ run_status: 'processing' }),
    busy: true,
  })
  await user.click(screen.getByRole('button', { name: 'Select fixture files' }))
  expect(screen.getByText('rules.txt')).toBeVisible()
  expect(screen.getByRole('button', { name: 'common.operation.retry' })).toBeDisabled()
})

it('does not offer a standalone attachment interaction while free text is unavailable', () => {
  renderComposer([], {
    attachmentsOnly: true,
    view: createSessionView({
      run_status: 'waiting_confirmation',
      decision: {
        title: 'Approve the plan?',
        options: [{ id: 'approve_plan', label: 'Approve' }],
      },
    }),
  })
  expect(
    screen.queryByRole('button', { name: 'common.fileUploader.uploadFromComputer' }),
  ).not.toBeInTheDocument()
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
})
