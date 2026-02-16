import type { FileEntity } from './types'
import type { FileUpload } from '@/app/components/base/features/types'
import { fireEvent, render } from '@testing-library/react'
import FileInput from './file-input'
import { FileContextProvider } from './store'

const mockHandleLocalFileUpload = vi.fn()

vi.mock('./hooks', () => ({
  useFile: () => ({
    handleLocalFileUpload: mockHandleLocalFileUpload,
  }),
}))

const createFileConfig = (overrides: Partial<FileUpload> = {}): FileUpload => ({
  enabled: true,
  allowed_file_types: ['image'],
  allowed_file_extensions: [],
  number_limits: 5,
  ...overrides,
} as FileUpload)

function createStubFile(id: string): FileEntity {
  return { id, name: `${id}.txt`, size: 0, type: '', progress: 100, transferMethod: 'local_file' as FileEntity['transferMethod'], supportFileType: 'document' }
}

function renderWithProvider(ui: React.ReactElement, fileIds: string[] = []) {
  return render(
    <FileContextProvider value={fileIds.map(createStubFile)}>
      {ui}
    </FileContextProvider>,
  )
}

describe('FileInput', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render a file input element', () => {
    renderWithProvider(<FileInput fileConfig={createFileConfig()} />)

    const input = document.querySelector('input[type="file"]')
    expect(input).toBeInTheDocument()
  })

  it('should set accept attribute based on allowed file types', () => {
    renderWithProvider(<FileInput fileConfig={createFileConfig({ allowed_file_types: ['image'] })} />)

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(input.accept).toBe('.JPG,.JPEG,.PNG,.GIF,.WEBP,.SVG')
  })

  it('should use custom extensions when file type is custom', () => {
    renderWithProvider(
      <FileInput fileConfig={createFileConfig({
        allowed_file_types: ['custom'] as unknown as FileUpload['allowed_file_types'],
        allowed_file_extensions: ['.csv', '.xlsx'],
      })}
      />,
    )

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(input.accept).toBe('.csv,.xlsx')
  })

  it('should allow multiple files when number_limits > 1', () => {
    renderWithProvider(<FileInput fileConfig={createFileConfig({ number_limits: 3 })} />)

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(input.multiple).toBe(true)
  })

  it('should not allow multiple files when number_limits is 1', () => {
    renderWithProvider(<FileInput fileConfig={createFileConfig({ number_limits: 1 })} />)

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(input.multiple).toBe(false)
  })

  it('should be disabled when file limit is reached', () => {
    renderWithProvider(
      <FileInput fileConfig={createFileConfig({ number_limits: 3 })} />,
      ['1', '2', '3'],
    )

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(input.disabled).toBe(true)
  })

  it('should not be disabled when file limit is not reached', () => {
    renderWithProvider(
      <FileInput fileConfig={createFileConfig({ number_limits: 3 })} />,
      ['1'],
    )

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(input.disabled).toBe(false)
  })

  it('should call handleLocalFileUpload when files are selected', () => {
    renderWithProvider(<FileInput fileConfig={createFileConfig()} />)

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['content'], 'test.jpg', { type: 'image/jpeg' })
    fireEvent.change(input, { target: { files: [file] } })

    expect(mockHandleLocalFileUpload).toHaveBeenCalledWith(file)
  })

  it('should respect number_limits when uploading multiple files', () => {
    renderWithProvider(
      <FileInput fileConfig={createFileConfig({ number_limits: 3 })} />,
      ['1', '2'],
    )

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file1 = new File(['content'], 'test1.jpg', { type: 'image/jpeg' })
    const file2 = new File(['content'], 'test2.jpg', { type: 'image/jpeg' })

    Object.defineProperty(input, 'files', {
      value: [file1, file2],
    })
    fireEvent.change(input)

    // Only 1 file should be uploaded (2 existing + 1 = 3 = limit)
    expect(mockHandleLocalFileUpload).toHaveBeenCalledTimes(1)
    expect(mockHandleLocalFileUpload).toHaveBeenCalledWith(file1)
  })

  it('should upload first file only when number_limits is not set', () => {
    renderWithProvider(<FileInput fileConfig={createFileConfig({ number_limits: undefined })} />)

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['content'], 'test.jpg', { type: 'image/jpeg' })
    fireEvent.change(input, { target: { files: [file] } })

    expect(mockHandleLocalFileUpload).toHaveBeenCalledWith(file)
  })

  it('should not upload when targetFiles is null', () => {
    renderWithProvider(<FileInput fileConfig={createFileConfig()} />)

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: null } })

    expect(mockHandleLocalFileUpload).not.toHaveBeenCalled()
  })

  it('should handle empty allowed_file_types', () => {
    renderWithProvider(<FileInput fileConfig={createFileConfig({ allowed_file_types: undefined })} />)

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(input.accept).toBe('')
  })

  it('should handle custom type with undefined allowed_file_extensions', () => {
    renderWithProvider(
      <FileInput fileConfig={createFileConfig({
        allowed_file_types: ['custom'] as unknown as FileUpload['allowed_file_types'],
        allowed_file_extensions: undefined,
      })}
      />,
    )

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(input.accept).toBe('')
  })

  it('should clear input value on click', () => {
    renderWithProvider(<FileInput fileConfig={createFileConfig()} />)

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    Object.defineProperty(input, 'value', { writable: true, value: 'some-file' })
    fireEvent.click(input)

    expect(input.value).toBe('')
  })
})
