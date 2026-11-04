import type { FileEntity } from '../../types'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createFileUploadConfigFixture } from '@/test/fixtures/file-upload-config'
import { FileContextProvider, useFileStoreWithSelector } from '../../store'
import { useUpload } from '../use-upload'

const { upload, error } = vi.hoisted(() => ({ upload: vi.fn(), error: vi.fn() }))
vi.mock('@/app/components/base/file-uploader/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/components/base/file-uploader/utils')>()),
  fileUpload: (options: unknown) => upload(options),
}))
vi.mock('@/app/notifications', () => ({ toast: { error } }))

function Uploader() {
  const {
    uploaderRef,
    dropRef,
    dragRef,
    dragging,
    fileChangeHandle,
    selectHandle,
    handleRemoveFile,
    handleReUploadFile,
  } = useUpload()
  const files = useFileStoreWithSelector((state) => state.files)
  return (
    <div ref={dropRef} data-testid="drop-zone">
      <div ref={dragRef} data-testid="drag-overlay">
        {dragging ? 'Drop images' : 'Upload images'}
      </div>
      <input
        type="file"
        multiple
        aria-label="Images"
        ref={uploaderRef}
        onChange={fileChangeHandle}
      />
      <button onClick={selectHandle}>Browse</button>
      {files.map((file) => (
        <div key={file.id}>
          <output aria-label={file.name}>{file.progress}</output>
          <button onClick={() => handleRemoveFile(file.id)}>Remove {file.name}</button>
          <button onClick={() => handleReUploadFile(file.id)}>Retry {file.name}</button>
        </div>
      ))}
    </div>
  )
}

const savedFile = (id: string): FileEntity => ({
  id,
  name: `${id}.png`,
  extension: 'png',
  mimeType: 'image/png',
  size: 10,
  progress: 100,
  uploadedId: id,
})
function setup(files: FileEntity[] = []) {
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(
    consoleQuery.files.upload.get.queryOptions().queryKey,
    createFileUploadConfigFixture({
      image_file_batch_limit: 2,
      single_chunk_attachment_limit: 3,
      attachment_image_file_size_limit: 15,
    }),
  )
  const onChange = vi.fn()
  renderWithConsoleQuery(
    <FileContextProvider value={files} onChange={onChange}>
      <Uploader />
    </FileContextProvider>,
    { queryClient },
  )
  return { onChange }
}
const image = () => new File(['image'], 'New.png', { type: 'image/png' })
beforeEach(() => upload.mockReset())

it('persists progress and server metadata for the selected image', async () => {
  const user = userEvent.setup()
  const { onChange } = setup()
  const file = image()
  await user.upload(screen.getByLabelText('Images'), file)
  await waitFor(() => expect(upload).toHaveBeenCalledTimes(1))
  const callbacks = upload.mock.lastCall![0]
  expect(callbacks.file).toBe(file)
  act(() => callbacks.onProgressCallback(53))
  expect(screen.getByLabelText('New.png')).toHaveTextContent('53')
  act(() =>
    callbacks.onSuccessCallback({
      id: 'uploaded-id',
      extension: 'webp',
      mime_type: 'image/webp',
      size: 123,
    }),
  )
  expect(onChange).toHaveBeenLastCalledWith([
    expect.objectContaining({
      name: 'New.png',
      originalFile: file,
      uploadedId: 'uploaded-id',
      progress: 100,
      extension: 'webp',
      mimeType: 'image/webp',
      size: 123,
      base64Url: expect.stringMatching(/^data:image\/png;base64,/),
    }),
  ])
})

it('keeps a failed image available for retry and updates the same attachment', async () => {
  const user = userEvent.setup()
  const { onChange } = setup([savedFile('existing')])
  const file = image()
  await user.upload(screen.getByLabelText('Images'), file)
  await waitFor(() => expect(upload).toHaveBeenCalledTimes(1))
  act(() => upload.mock.lastCall![0].onErrorCallback(new Error('offline')))
  expect(screen.getByLabelText('New.png')).toHaveTextContent('-1')
  expect(error).toHaveBeenCalledWith('common.fileUploader.uploadFromComputerUploadError')
  await user.click(screen.getByRole('button', { name: 'Retry New.png' }))
  expect(screen.getByLabelText('New.png')).toHaveTextContent('0')
  expect(upload.mock.lastCall![0].file).toBe(file)
  act(() => upload.mock.lastCall![0].onSuccessCallback({ id: 'retry-id' }))
  expect(onChange).toHaveBeenLastCalledWith([
    savedFile('existing'),
    expect.objectContaining({ uploadedId: 'retry-id', progress: 100, originalFile: file }),
  ])
  await user.click(screen.getByRole('button', { name: 'Remove New.png' }))
  expect(onChange).toHaveBeenLastCalledWith([savedFile('existing')])
})

it.each(['extension', 'size'])(
  'rejects an image with invalid %s before uploading',
  async (reason) => {
    const user = userEvent.setup()
    setup()
    const file = reason === 'extension' ? new File(['bad'], 'malware.exe') : image()
    if (reason === 'size') Object.defineProperty(file, 'size', { value: 16 * 1024 * 1024 })
    await user.upload(screen.getByLabelText('Images'), file)
    expect(error).toHaveBeenCalledWith(
      reason === 'extension'
        ? 'common.fileUploader.fileExtensionNotSupport'
        : expect.stringContaining('dataset.imageUploader.fileSizeLimitExceeded'),
    )
    expect(upload).not.toHaveBeenCalled()
  },
)

it('limits a selection to the configured batch size', async () => {
  const user = userEvent.setup()
  setup()
  const files = ['one', 'two', 'three'].map(
    (name) => new File(['image'], `${name}.png`, { type: 'image/png' }),
  )
  await user.upload(screen.getByLabelText('Images'), files)
  await waitFor(() => expect(upload).toHaveBeenCalledTimes(2))
  expect(upload.mock.calls.map(([options]) => options.file)).toEqual(files.slice(0, 2))
})

it('rejects a batch that would exceed the total attachment limit', async () => {
  const user = userEvent.setup()
  const { onChange } = setup([savedFile('one'), savedFile('two')])
  await user.upload(screen.getByLabelText('Images'), [
    image(),
    new File(['image'], 'Other.png', { type: 'image/png' }),
  ])
  expect(error).toHaveBeenCalledWith(
    expect.stringContaining('datasetHitTesting.imageUploader.singleChunkAttachmentLimitTooltip'),
  )
  expect(upload).not.toHaveBeenCalled()
  expect(onChange).not.toHaveBeenCalled()
})

it('opens the file chooser from the browse action', async () => {
  const user = userEvent.setup()
  setup()
  const click = vi.spyOn(screen.getByLabelText('Images'), 'click')
  await user.click(screen.getByRole('button', { name: 'Browse' }))
  expect(click).toHaveBeenCalledTimes(1)
})

it('reports a FileReader failure without adding an attachment', async () => {
  const user = userEvent.setup()
  const read = vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function (
    this: FileReader,
  ) {
    this.dispatchEvent(new Event('error'))
  })
  try {
    const { onChange } = setup()
    await user.upload(screen.getByLabelText('Images'), image())
    expect(error).toHaveBeenCalledWith('common.fileUploader.uploadFromComputerReadError')
    expect(upload).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
  } finally {
    read.mockRestore()
  }
})

it.each([false, true])(
  'uploads dropped files through the file-entry API when available (%s)',
  async (hasEntry) => {
    setup()
    const file = image()
    const zone = screen.getByTestId('drop-zone')
    fireEvent.dragEnter(zone)
    expect(screen.getByTestId('drag-overlay')).toHaveTextContent('Drop images')
    fireEvent.drop(zone, {
      dataTransfer: {
        items: [
          {
            getAsFile: () => file,
            webkitGetAsEntry: () =>
              hasEntry
                ? {
                    isFile: true,
                    isDirectory: false,
                    file: (callback: (file: File) => void) => callback(file),
                  }
                : null,
          },
        ],
      },
    })
    expect(screen.getByTestId('drag-overlay')).toHaveTextContent('Upload images')
    await waitFor(() => expect(upload).toHaveBeenCalledWith(expect.objectContaining({ file })))
  },
)

it('keeps the drag overlay open while moving inside the drop zone and closes it when leaving the overlay', () => {
  setup()
  const zone = screen.getByTestId('drop-zone')
  const overlay = screen.getByTestId('drag-overlay')
  fireEvent.dragEnter(zone)
  fireEvent.dragLeave(zone)
  expect(overlay).toHaveTextContent('Drop images')
  fireEvent.dragLeave(overlay)
  expect(overlay).toHaveTextContent('Upload images')
})
