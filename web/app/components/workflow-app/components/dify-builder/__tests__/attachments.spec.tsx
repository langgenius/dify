import type { FileEntity } from '@/app/components/base/file-uploader/types'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider } from 'jotai'
import { useFileStore } from '@/app/components/base/file-uploader/store'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createDifyBuilderRuntime } from '@/test/fixtures/dify-builder'
import { DifyBuilderAttachmentScope } from '../attachments'
import DifyBuilderComposer from '../composer'
import { createSessionView } from '../session/__tests__/fixtures'
import {
  difyBuilderMaterialControlAtom,
  difyBuilderSessionBusyAtom,
  difyBuilderSessionViewAtom,
} from '../session/state'
import { difyBuilderDraftAtom, difyBuilderRuntimeAtom } from '../store'

vi.mock('@/next/navigation', () => ({
  useParams: () => ({}),
  usePathname: () => '/app/app-1/workflow',
}))
vi.mock('../model-selector', () => ({
  default: () => <button type="button">Model selector</button>,
}))
vi.mock('../use-dify-builder-model', () => ({
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
const renderComposer = (files: FileEntity[], attachmentsOnly = false) => {
  const store = createStore()
  const runtime = createDifyBuilderRuntime()
  store.set(difyBuilderRuntimeAtom, runtime)
  store.set(difyBuilderSessionViewAtom, createSessionView({ run_status: 'processing' }))
  store.set(difyBuilderSessionBusyAtom, true)
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

it('keeps Stop available while sending native file chips and preserves files/text after failure', async () => {
  const user = userEvent.setup()
  const { store, runtime } = renderComposer([uploadedFile])
  runtime.session.sendMessage = vi.fn(async () => false)
  await user.click(screen.getByRole('button', { name: 'Select fixture files' }))
  expect(screen.getByText('rules.txt')).toBeVisible()
  expect(screen.getByRole('button', { name: 'difyBuilder.taskControl.stop' })).toBeEnabled()
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

it('keeps structured interaction drafts separate and locks uncertain material against resending', async () => {
  const user = userEvent.setup()
  const { store, runtime } = renderComposer([uploadedFile], true)
  await user.click(screen.getByRole('button', { name: 'Select fixture files' }))
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'difyBuilder.messageSend' }))
  expect(runtime.session.sendMessage).toHaveBeenCalledExactlyOnceWith('', undefined, [
    { upload_file_id: 'upload-1' },
  ])
  expect(store.get(difyBuilderDraftAtom)).toBe('Keep this context')
  await user.click(screen.getByRole('button', { name: 'Select fixture files' }))
  act(() =>
    store.set(difyBuilderMaterialControlAtom, {
      phase: 'unknown',
      clientTurnId: 'material-1',
      text: '',
      attachments: [{ upload_file_id: 'upload-1' }],
    }),
  )
  expect(screen.getByText('rules.txt')).toBeVisible()
  expect(screen.getByRole('button', { name: 'difyBuilder.messageSend' })).toBeDisabled()
  expect(runtime.session.sendMessage).toHaveBeenCalledOnce()
})
