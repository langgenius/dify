import type { FileEntity } from '../types'
import type { FileUpload } from '@/app/components/base/features/types'
import { fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import FileInput from '../file-input'
import { createFileStore, FileContext } from '../store'
import { fileUpload } from '../utils'

vi.mock('../utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils')>()),
  fileUpload: vi.fn(),
}))
vi.mock('@/next/navigation', () => ({ useParams: () => ({}), usePathname: () => '/chat' }))

const createFileConfig = (overrides: Partial<FileUpload> = {}): FileUpload => ({
  enabled: true,
  allowed_file_types: ['image'],
  allowed_file_extensions: [],
  number_limits: 5,
  allowed_file_upload_methods: ['local_file'],
  ...overrides,
})

function createUploadedFile(id: string): FileEntity {
  return {
    id,
    name: `${id}.jpg`,
    size: 1,
    type: 'image/jpeg',
    uploadedId: `uploaded-${id}`,
    progress: 100,
    transferMethod: 'local_file',
    supportFileType: 'image',
  }
}

function renderWithProvider(ui: React.ReactElement, fileIds: string[] = []) {
  const store = createFileStore(fileIds.map(createUploadedFile))
  return { ...renderWithConsoleQuery(<FileContext value={store}>{ui}</FileContext>), store }
}

describe('FileInput', () => {
  beforeEach(() => {
    vi.mocked(fileUpload).mockImplementation(({ file, onSuccessCallback }) => {
      onSuccessCallback({
        id: `uploaded-${file.name}`,
        name: file.name,
        size: file.size,
        mime_type: file.type,
        extension: 'jpg',
        created_at: 0,
        created_by: 'user-1',
        preview_url: null,
        source_url: '',
      })
    })
  })

  it('should set accept attribute based on allowed file types', () => {
    renderWithProvider(
      <FileInput fileConfig={createFileConfig({ allowed_file_types: ['image'] })} />,
    )

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(input.accept).toBe('.JPG,.JPEG,.PNG,.GIF,.WEBP,.SVG')
  })

  it('should use custom extensions when file type is custom', () => {
    renderWithProvider(
      <FileInput
        fileConfig={createFileConfig({
          allowed_file_types: ['custom'],
          allowed_file_extensions: ['.csv', '.xlsx'],
        })}
      />,
    )

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(input.accept).toBe('.csv,.xlsx')
  })

  it('should be disabled when file limit is reached', () => {
    renderWithProvider(<FileInput fileConfig={createFileConfig({ number_limits: 3 })} />, [
      '1',
      '2',
      '3',
    ])

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(input.disabled).toBe(true)
  })

  it('should respect number_limits when uploading multiple files', async () => {
    const user = userEvent.setup()
    const { store } = renderWithProvider(
      <FileInput fileConfig={createFileConfig({ number_limits: 3 })} />,
      ['1', '2'],
    )

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file1 = new File(['content'], 'test1.jpg', { type: 'image/jpeg' })
    const file2 = new File(['content'], 'test2.jpg', { type: 'image/jpeg' })

    await user.upload(input, [file1, file2])

    await waitFor(() => expect(store.getState().files).toHaveLength(3))
    expect(store.getState().files).toEqual([
      createUploadedFile('1'),
      createUploadedFile('2'),
      expect.objectContaining({
        name: 'test1.jpg',
        uploadedId: 'uploaded-test1.jpg',
        progress: 100,
        originalFile: file1,
      }),
    ])
    expect(input).toBeDisabled()
    expect(fileUpload).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ file: file1 }),
      false,
      undefined,
    )
  })

  it('should upload first file only when number_limits is not set', async () => {
    const user = userEvent.setup()
    const { store } = renderWithProvider(
      <FileInput fileConfig={createFileConfig({ number_limits: undefined })} />,
    )

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['content'], 'test.jpg', { type: 'image/jpeg' })
    await user.upload(input, [file, new File(['other'], 'other.jpg', { type: 'image/jpeg' })])

    await waitFor(() =>
      expect(store.getState().files).toEqual([
        expect.objectContaining({
          name: 'test.jpg',
          uploadedId: 'uploaded-test.jpg',
          progress: 100,
        }),
      ]),
    )
  })

  it('should not upload an empty selection without a configured limit', () => {
    const { store } = renderWithProvider(
      <FileInput fileConfig={createFileConfig({ number_limits: undefined })} />,
    )

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [] } })

    expect(fileUpload).not.toHaveBeenCalled()
    expect(store.getState().files).toEqual([])
  })

  it('should handle empty allowed_file_types', () => {
    renderWithProvider(
      <FileInput fileConfig={createFileConfig({ allowed_file_types: undefined })} />,
    )

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(input.accept).toBe('')
  })

  it('should handle custom type with undefined allowed_file_extensions', () => {
    renderWithProvider(
      <FileInput
        fileConfig={createFileConfig({
          allowed_file_types: ['custom'],
          allowed_file_extensions: undefined,
        })}
      />,
    )

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(input.accept).toBe('')
  })

  it('allows selecting the same file again', async () => {
    const user = userEvent.setup()
    const { container, store } = renderWithProvider(<FileInput fileConfig={createFileConfig()} />)
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
    const file = new File(['content'], 'test.jpg', { type: 'image/jpeg' })
    await user.upload(input, file)
    await user.upload(input, file)
    await waitFor(() => expect(store.getState().files).toHaveLength(2))
    expect(store.getState().files).toEqual([
      expect.objectContaining({
        originalFile: file,
        uploadedId: 'uploaded-test.jpg',
        progress: 100,
      }),
      expect.objectContaining({
        originalFile: file,
        uploadedId: 'uploaded-test.jpg',
        progress: 100,
      }),
    ])
  })
})
