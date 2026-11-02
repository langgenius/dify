import type { FileResponse } from '@dify/contracts/api/console/files/types.gen'
import type { ComponentProps } from 'react'
import type { FileItem } from '@/models/datasets'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { toast } from '@/app/notifications'
import { AppToaster } from '@/app/notifications/app-toaster'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createFileUploadConfigFixture } from '@/test/fixtures/file-upload-config'
import FileUploader from '../index'

const upload = vi.hoisted(() => vi.fn<typeof import('@/service/base').upload>())
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  upload,
}))

const file = (name = 'Guide.pdf') => new File(['document'], name, { type: 'application/pdf' })
const response = (name = 'Guide.pdf'): FileResponse => ({
  id: `server-${name}`,
  name,
  size: 8,
  extension: 'pdf',
  mime_type: 'application/pdf',
})
const savedFile = (name: string): FileItem => ({
  fileID: name,
  file: Object.assign(file(name), { id: `server-${name}` }),
  progress: 100,
})
const input = () => screen.getByLabelText('datasetCreation.stepOne.uploader.browse')
const preview = (name = 'Guide.pdf') =>
  screen.getByRole('button', { name: `datasetCreation.stepOne.filePreview ${name}` })
const remove = (name = 'Guide.pdf') =>
  screen.getByRole('button', { name: `common.operation.remove ${name}` })
const tip = () => screen.getByText(/datasetCreation.stepOne.uploader.tip/)

const setup = ({
  fileList = [],
  supportBatchUpload = true,
  edition = 'CLOUD',
  formats = ['pdf', 'docx', 'txt', 'md'],
}: {
  fileList?: FileItem[]
  supportBatchUpload?: boolean
  edition?: 'CLOUD' | 'COMMUNITY'
  formats?: string[]
} = {}) => {
  // Disable chooser filtering so invalid selections reach application validation.
  const user = userEvent.setup({ applyAccept: false })
  const onPreview = vi.fn<ComponentProps<typeof FileUploader>['onPreview']>()
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(
    consoleQuery.files.upload.get.queryKey(),
    createFileUploadConfigFixture({
      file_size_limit: 1,
      knowledge_file_size_limit: 2,
      batch_count_limit: 2,
      file_upload_limit: 3,
    }),
  )
  queryClient.setQueryData(consoleQuery.files.supportType.get.queryKey(), {
    allowed_extensions: formats,
  })
  function Owner() {
    const [files, setFiles] = useState(fileList)
    return (
      <FileUploader
        fileList={files}
        supportBatchUpload={supportBatchUpload}
        prepareFileList={(next) => setFiles([...next])}
        onFileListUpdate={setFiles}
        onFileUpdate={(item, progress, list) =>
          setFiles(
            list.map((entry) => (entry.fileID === item.fileID ? { ...item, progress } : entry)),
          )
        }
        onPreview={onPreview}
      />
    )
  }
  renderWithConsoleQuery(
    <>
      <Owner />
      <AppToaster timeout={0} />
    </>,
    { queryClient, systemFeatures: { deployment_edition: edition } },
  )
  return { user, onPreview }
}

beforeEach(() => {
  upload.mockReset().mockImplementation(async ({ data }) => {
    const selected = data.get('file')
    if (!(selected instanceof File)) throw new Error('Expected an uploaded file')
    return response(selected.name)
  })
})
afterEach(() => {
  toast.dismiss()
  vi.restoreAllMocks()
})

it('preserves existing documents through upload progress, server acceptance, preview and removal', async () => {
  const pending = createDeferred<FileResponse>()
  upload.mockReturnValue(pending.promise)
  const { user, onPreview } = setup({ fileList: [savedFile('Existing.pdf')] })
  const selected = file()
  await user.upload(input(), selected)
  expect(preview()).toBeDisabled()
  expect(preview('Existing.pdf')).toBeEnabled()
  expect(screen.getByRole('status')).toHaveTextContent('Guide.pdf: common.loading')
  expect(upload).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ data: expect.any(FormData) }),
    false,
    undefined,
    '?source=datasets',
  )
  const request = upload.mock.calls[0]![0]
  expect(request.data.get('file')).toMatchObject({ name: selected.name, size: selected.size })
  for (const loaded of [53, 100]) {
    act(() =>
      request.onprogress?.call(
        request.xhr,
        new ProgressEvent('progress', { lengthComputable: true, loaded, total: 100 }),
      ),
    )
    expect(screen.getByRole('status')).toHaveTextContent('Guide.pdf: common.loading')
    expect(preview()).toBeDisabled()
  }
  await act(async () => pending.resolve(response()))
  expect(
    await screen.findByText('Guide.pdf: datasetCreation.stepOne.uploader.completed'),
  ).toBeInTheDocument()
  await user.click(preview())
  expect(onPreview).toHaveBeenCalledExactlyOnceWith(response())
  await user.click(remove())
  expect(screen.queryByText('Guide.pdf')).not.toBeInTheDocument()
  expect(preview('Existing.pdf')).toBeEnabled()
  expect(onPreview).toHaveBeenCalledOnce()
})

it('keeps the live status present before upload and announces mixed batch results by filename', async () => {
  upload.mockRejectedValueOnce(new Error('offline'))
  const { user, onPreview } = setup()
  expect(screen.getByRole('status')).toBeEmptyDOMElement()
  await user.upload(input(), [file('Failed.pdf'), file('Ready.pdf')])
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent(
      'Failed.pdf: datasetCreation.stepOne.uploader.failed',
    ),
  )
  expect(screen.getByRole('status')).toHaveTextContent(
    'Ready.pdf: datasetCreation.stepOne.uploader.completed',
  )
  expect(screen.getByRole('status')).toHaveAttribute('aria-atomic', 'false')
  expect(
    await screen.findByText('datasetCreation.stepOne.uploader.failed', { exact: true }),
  ).toBeVisible()
  await user.click(preview('Failed.pdf'))
  expect(onPreview).not.toHaveBeenCalled()
  await user.click(remove('Failed.pdf'))
  expect(preview('Ready.pdf')).toBeEnabled()
})

it('restores single-file upload after removal and accepts the same file again', async () => {
  const { user, onPreview } = setup({ supportBatchUpload: false })
  const selected = file()
  expect(input()).not.toHaveAttribute('multiple')
  await user.upload(input(), selected)
  await waitFor(() => expect(preview()).toBeEnabled())
  expect(screen.queryByLabelText('datasetCreation.stepOne.uploader.browse')).not.toBeInTheDocument()
  await user.tab()
  expect(preview()).toHaveFocus()
  await user.keyboard('{Enter}')
  await user.tab()
  expect(remove()).toHaveFocus()
  await user.keyboard(' ')
  expect(onPreview).toHaveBeenCalledOnce()
  await user.upload(input(), selected)
  await waitFor(() => expect(preview()).toBeEnabled())
  expect(upload).toHaveBeenCalledTimes(2)
})

it.each(['COMMUNITY', 'CLOUD'] as const)(
  'shows and enforces the applicable limits for %s',
  async (edition) => {
    const { user } = setup({ edition, fileList: [savedFile('One.pdf'), savedFile('Two.pdf')] })
    expect(tip()).toHaveTextContent('"size":2')
    expect(tip()).toHaveTextContent('"batchCount":2')
    expect(tip()).toHaveTextContent('"supportTypes":"PDF, DOCX, TXT, MARKDOWN"')
    await user.upload(input(), [file('Three.pdf'), file('Four.pdf')])
    if (edition === 'CLOUD') {
      expect(tip()).toHaveTextContent('"totalCount":3')
      expect(
        await screen.findByText(
          'datasetCreation.stepOne.uploader.validation.filesNumber:{"filesNumber":3}',
        ),
      ).toBeVisible()
      expect(upload).not.toHaveBeenCalled()
      expect(screen.queryByText('Three.pdf')).not.toBeInTheDocument()
    } else {
      expect(tip()).not.toHaveTextContent('"totalCount"')
      await waitFor(() => expect(preview('Four.pdf')).toBeEnabled())
      expect(upload).toHaveBeenCalledTimes(2)
    }
    expect(preview('One.pdf')).toBeEnabled()
    expect(preview('Two.pdf')).toBeEnabled()
  },
)

it.each([
  {
    reason: 'unsupported extension',
    makeFile: () => file('invalid.exe'),
    error: 'datasetCreation.stepOne.uploader.validation.typeError',
  },
  {
    reason: 'knowledge file size limit',
    makeFile: () =>
      new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'Large.pdf', { type: 'application/pdf' }),
    error: 'datasetCreation.stepOne.uploader.validation.size:{"size":2}',
  },
])('rejects $reason before uploading', async ({ makeFile, error }) => {
  const { user } = setup()
  await user.upload(input(), makeFile())
  expect(await screen.findByText(error)).toBeVisible()
  expect(upload).not.toHaveBeenCalled()
  expect(screen.getByRole('status')).toBeEmptyDOMElement()
})

it('limits selections to the configured batch size and accepts case-insensitive extensions', async () => {
  const { user } = setup()
  await user.upload(input(), [file('First.PDF'), file('Second.pdf'), file('Third.pdf')])
  await waitFor(() => expect(preview('Second.pdf')).toBeEnabled())
  expect(preview('First.PDF')).toBeEnabled()
  expect(upload).toHaveBeenCalledTimes(2)
  expect(screen.queryByText('Third.pdf')).not.toBeInTheDocument()
})

it('connects Browse to the file chooser and exposes supported file types', async () => {
  const { user } = setup()
  const click = vi.spyOn(input(), 'click')
  expect(input()).toHaveAttribute('accept', '.pdf,.docx,.txt,.md')
  await user.click(screen.getByRole('button', { name: 'datasetCreation.stepOne.uploader.browse' }))
  expect(click).toHaveBeenCalledOnce()
})

it('does not offer Browse when no file types are supported', () => {
  setup({ formats: [] })
  expect(
    screen.queryByRole('button', { name: 'datasetCreation.stepOne.uploader.browse' }),
  ).not.toBeInTheDocument()
})

// Synthetic drops exercise the OS file-data contract, not native drag gesture generation.
it.each([true, false])('uploads dropped files with batch mode %s', async (supportBatchUpload) => {
  setup({ supportBatchUpload })
  const dataTransfer = new DataTransfer()
  for (const name of ['One.pdf', 'Two.pdf', 'Three.pdf']) dataTransfer.items.add(file(name))
  fireEvent.drop(tip(), { dataTransfer })
  await waitFor(() => expect(preview('One.pdf')).toBeEnabled())
  expect(upload).toHaveBeenCalledTimes(supportBatchUpload ? 2 : 1)
  expect(screen.queryByText('Three.pdf')).not.toBeInTheDocument()
})

type Entry = {
  isFile: boolean
  isDirectory: boolean
  name: string
  file?: (callback: (file: File) => void) => void
  createReader?: () => { readEntries: (callback: (entries: Entry[]) => void) => void }
}
const fileEntry = (name: string): Entry => ({
  isFile: true,
  isDirectory: false,
  name,
  file: (callback) => callback(file(name)),
})
const directoryEntry = (name: string, batches: Entry[][]): Entry => ({
  isFile: false,
  isDirectory: true,
  name,
  createReader: () => {
    let page = 0
    return { readEntries: (callback) => callback(batches[page++] ?? []) }
  },
})

it('reads all directory batches and nested files while filtering unsupported files', async () => {
  setup()
  const directory = directoryEntry('folder', [
    [fileEntry('invalid.exe')],
    [directoryEntry('nested', [[fileEntry('Nested.pdf')]])],
  ])
  fireEvent.drop(tip(), { dataTransfer: { items: [{ webkitGetAsEntry: () => directory }] } })
  await waitFor(() => expect(preview('Nested.pdf')).toBeEnabled())
  expect(upload).toHaveBeenCalledOnce()
  expect(screen.queryByText('invalid.exe')).not.toBeInTheDocument()
})

it('ignores an empty dropped directory', async () => {
  setup()
  await act(async () =>
    fireEvent.drop(tip(), {
      dataTransfer: { items: [{ webkitGetAsEntry: () => directoryEntry('empty', []) }] },
    }),
  )
  expect(upload).not.toHaveBeenCalled()
  expect(screen.getByRole('status')).toBeEmptyDOMElement()
})
