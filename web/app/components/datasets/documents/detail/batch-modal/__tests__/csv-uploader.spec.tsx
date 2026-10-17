import type { ReactElement } from 'react'
import type { FileItem } from '@/models/datasets'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vite-plus/test'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createFileUploadConfigFixture } from '@/test/fixtures/file-upload-config'
import { Theme } from '@/types/app'
import CSVUploader from '../csv-uploader'

// Mock upload service
const mockUpload = vi.fn()
vi.mock('@/service/base', () => ({
  upload: (...args: unknown[]) => mockUpload(...args),
}))

// Mock useFileUploadConfig

// Mock useTheme
vi.mock('@/hooks/use-theme', () => ({
  default: () => ({ theme: Theme.light }),
}))

const toastMocks = vi.hoisted(() => {
  const call = vi.fn()
  return {
    call,
    api: Object.assign(
      vi.fn((message: unknown, options?: Record<string, unknown>) => call({ message, ...options })),
      {
        success: vi.fn((message, options) => call({ type: 'success', message, ...options })),
        error: vi.fn((message, options) => call({ type: 'error', message, ...options })),
        warning: vi.fn((message, options) => call({ type: 'warning', message, ...options })),
        info: vi.fn((message, options) => call({ type: 'info', message, ...options })),
        dismiss: vi.fn(),
        update: vi.fn(),
        promise: vi.fn(),
      },
    ),
  }
})

vi.mock('@/app/notifications', () => ({
  toast: toastMocks.api,
}))

const render = (ui: ReactElement) => {
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(
    consoleQuery.files.upload.get.queryKey(),
    createFileUploadConfigFixture(),
  )
  return renderWithConsoleQuery(ui, { queryClient })
}

const createFile = (name = 'records.csv') =>
  new File(['question,answer'], name, { type: 'text/csv', lastModified: 1700000000 })
function setup(file?: FileItem) {
  const updateFile = vi.fn()
  const view = render(<CSVUploader file={file} updateFile={updateFile} />)
  // This hidden native input has no accessible label; browse is its user-facing trigger.
  const input = view.container.querySelector<HTMLInputElement>('input[type="file"]')!
  return { ...view, input, updateFile }
}

beforeEach(() =>
  mockUpload.mockReset().mockResolvedValue({ id: 'uploaded-id', name: 'records.csv' }),
)

it('opens the file chooser from browse and permits selecting a file again after removal', async () => {
  const user = userEvent.setup()
  const file = createFile()
  const { input, updateFile, rerender } = setup()
  const click = vi.spyOn(input, 'click')
  await user.click(screen.getByRole('button', { name: /batchModal.browse/ }))
  expect(click).toHaveBeenCalledOnce()
  await user.upload(input, file)
  await waitFor(() =>
    expect(updateFile).toHaveBeenLastCalledWith(expect.objectContaining({ progress: 100 })),
  )
  rerender(
    <CSVUploader file={{ fileID: 'selected', file, progress: 100 }} updateFile={updateFile} />,
  )
  await user.click(screen.getByRole('button', { name: 'common.operation.delete' }))
  expect(updateFile).toHaveBeenLastCalledWith()
  expect(input.value).toBe('')
  await user.upload(input, file)
  await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(2))
})

it.each(['wrong.txt', 'noextension', 'oversized.csv'])(
  'rejects invalid selection %s before uploading',
  async (name) => {
    const user = userEvent.setup({ applyAccept: false })
    const { input, updateFile } = setup()
    const file = createFile(name)
    if (name === 'oversized.csv') Object.defineProperty(file, 'size', { value: 16 * 1024 * 1024 })
    await user.upload(input, file)
    expect(toastMocks.call).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
    expect(mockUpload).not.toHaveBeenCalled()
    expect(updateFile).not.toHaveBeenCalled()
  },
)

it('reports computable upload progress and the returned file identity', async () => {
  const user = userEvent.setup()
  const pending = createDeferred<{ id: string; name: string }>()
  let progress!: (event: ProgressEvent) => void
  mockUpload.mockImplementationOnce(({ onprogress }) => {
    progress = onprogress
    return pending.promise
  })
  const { input, updateFile } = setup()
  const file = createFile('my.data.csv')
  await user.upload(input, file)
  expect(mockUpload.mock.calls[0]![0].data.get('file')).toBe(file)
  const count = updateFile.mock.calls.length
  act(() =>
    progress(new ProgressEvent('progress', { lengthComputable: false, loaded: 50, total: 100 })),
  )
  expect(updateFile).toHaveBeenCalledTimes(count)
  act(() =>
    progress(new ProgressEvent('progress', { lengthComputable: true, loaded: 53, total: 100 })),
  )
  expect(updateFile).toHaveBeenLastCalledWith(expect.objectContaining({ file, progress: 53 }))
  await act(async () => pending.resolve({ id: 'server-id', name: 'my.data.csv' }))
  await waitFor(() =>
    expect(updateFile).toHaveBeenLastCalledWith(
      expect.objectContaining({
        file: expect.objectContaining({ id: 'server-id', name: 'my.data.csv' }),
        progress: 100,
      }),
    ),
  )
})

it('marks the selected file as failed when upload rejects', async () => {
  const user = userEvent.setup()
  mockUpload.mockRejectedValueOnce(new Error('offline'))
  const { input, updateFile } = setup()
  const file = createFile()
  await user.upload(input, file)
  await waitFor(() =>
    expect(updateFile).toHaveBeenLastCalledWith(expect.objectContaining({ file, progress: -2 })),
  )
  expect(toastMocks.call).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
})

it.each([1, 2])('accepts one dropped file and rejects multiple files (%s)', async (count) => {
  const { input, updateFile } = setup()
  // Native drop events enter at the uploader drop target; they are not generated by happy-dom.
  fireEvent.drop(input.nextElementSibling!, {
    dataTransfer: {
      files: Array.from({ length: count }, (_, i) => createFile(`records-${i}.csv`)),
    },
  })
  if (count === 1) {
    await waitFor(() =>
      expect(updateFile).toHaveBeenLastCalledWith(expect.objectContaining({ progress: 100 })),
    )
    expect(mockUpload).toHaveBeenCalledOnce()
  } else {
    expect(mockUpload).not.toHaveBeenCalled()
    expect(toastMocks.call).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        message: 'datasetCreation.stepOne.uploader.validation.count',
      }),
    )
  }
})
