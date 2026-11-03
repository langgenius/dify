import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createFileUploadConfigFixture } from '@/test/fixtures/file-upload-config'
import { createDataSourceStore } from '../../../store'
import { DataSourceContext } from '../../../store/provider'
import { useLocalFileUpload } from '../use-local-file-upload'

const upload = vi.fn()
vi.mock('@/service/base', () => ({ upload: (...args: unknown[]) => upload(...args) }))
vi.mock('@/app/notifications', () => ({ toast: { error: vi.fn() } }))

function Uploader() {
  const { fileUploaderRef, fileChangeHandle, localFileList, removeFile } = useLocalFileUpload({
    allowedExtensions: ['pdf'],
  })
  return (
    <>
      <input
        aria-label="Upload documents"
        type="file"
        ref={fileUploaderRef}
        onChange={fileChangeHandle}
      />
      {localFileList.map((item) => (
        <button key={item.fileID} onClick={() => removeFile(item.fileID)}>
          Remove {item.file.name}
        </button>
      ))}
    </>
  )
}

function setup() {
  const store = createDataSourceStore()
  const existing = {
    fileID: 'existing',
    file: Object.assign(new File(['existing'], 'Existing.pdf'), { id: 'server-existing' }),
    progress: 100,
  }
  store.getState().setLocalFileList([existing])
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(
    consoleQuery.files.upload.get.queryOptions().queryKey,
    createFileUploadConfigFixture(),
  )
  queryClient.setQueryData(consoleQuery.files.supportType.get.queryOptions().queryKey, {
    allowed_extensions: ['pdf'],
  })
  renderWithConsoleQuery(
    <DataSourceContext value={store}>
      <Uploader />
    </DataSourceContext>,
    { queryClient, systemFeatures: { deployment_edition: 'CLOUD' } },
  )
  return { store, existing }
}

// Generic validation, drop handling and limits belong to useFileUpload. This
// adapter owns merging upload transitions into the pipeline's data-source store.
it('updates only the uploaded file and preserves other files through progress, success and removal', async () => {
  const user = userEvent.setup()
  let resolve!: (value: { id: string; name: string }) => void
  upload.mockImplementationOnce(
    () =>
      new Promise((res) => {
        resolve = res
      }),
  )
  const { store, existing } = setup()
  await user.upload(
    screen.getByLabelText('Upload documents'),
    new File(['new'], 'New.pdf', { type: 'application/pdf' }),
  )
  expect(store.getState().localFileList).toHaveLength(2)
  const request = upload.mock.lastCall![0]
  act(() => request.onprogress({ lengthComputable: true, loaded: 53, total: 100 }))
  expect(store.getState().localFileList[1]?.progress).toBe(53)
  expect(store.getState().localFileList[0]).toEqual(existing)
  await act(async () => resolve({ id: 'server-new', name: 'New.pdf' }))
  await waitFor(() =>
    expect(store.getState().localFileList[1]).toEqual({
      fileID: expect.any(String),
      file: { id: 'server-new', name: 'New.pdf' },
      progress: 100,
    }),
  )
  await user.click(screen.getByRole('button', { name: 'Remove New.pdf' }))
  expect(store.getState().localFileList).toEqual([existing])
})

it('marks a failed upload without losing existing documents', async () => {
  const user = userEvent.setup()
  upload.mockRejectedValueOnce(new Error('offline'))
  const { store, existing } = setup()
  await user.upload(
    screen.getByLabelText('Upload documents'),
    new File(['new'], 'New.pdf', { type: 'application/pdf' }),
  )
  await waitFor(() => expect(store.getState().localFileList[1]?.progress).toBe(-2))
  expect(store.getState().localFileList[0]).toEqual(existing)
  expect(store.getState().localFileList[1]?.file.name).toBe('New.pdf')
})
