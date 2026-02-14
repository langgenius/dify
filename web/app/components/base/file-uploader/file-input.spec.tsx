import type { FileUpload } from '@/app/components/base/features/types'
import { fireEvent, render } from '@testing-library/react'
import FileInput from './file-input'

const mockHandleLocalFileUpload = vi.fn()

vi.mock('./hooks', () => ({
  useFile: () => ({
    handleLocalFileUpload: mockHandleLocalFileUpload,
  }),
}))

let mockFiles: { id: string }[] = []
vi.mock('./store', () => ({
  useStore: (selector: (s: { files: { id: string }[] }) => unknown) => selector({ files: mockFiles }),
}))

vi.mock('@/app/components/base/prompt-editor/constants', () => ({
  FILE_EXTS: {
    image: ['jpg', 'png'],
    document: ['pdf', 'txt'],
  },
}))

vi.mock('@/app/components/workflow/types', () => ({
  SupportUploadFileTypes: {
    image: 'image',
    document: 'document',
    custom: 'custom',
  },
}))

const createFileConfig = (overrides: Partial<FileUpload> = {}): FileUpload => ({
  enabled: true,
  allowed_file_types: ['image'],
  allowed_file_extensions: [],
  number_limits: 5,
  ...overrides,
} as FileUpload)

describe('FileInput', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFiles = []
  })

  it('should render a file input element', () => {
    render(<FileInput fileConfig={createFileConfig()} />)

    const input = document.querySelector('input[type="file"]')
    expect(input).toBeInTheDocument()
  })

  it('should set accept attribute based on allowed file types', () => {
    render(<FileInput fileConfig={createFileConfig({ allowed_file_types: ['image'] })} />)

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(input.accept).toBe('.jpg,.png')
  })

  it('should use custom extensions when file type is custom', () => {
    render(
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
    render(<FileInput fileConfig={createFileConfig({ number_limits: 3 })} />)

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(input.multiple).toBe(true)
  })

  it('should not allow multiple files when number_limits is 1', () => {
    render(<FileInput fileConfig={createFileConfig({ number_limits: 1 })} />)

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(input.multiple).toBe(false)
  })

  it('should be disabled when file limit is reached', () => {
    mockFiles = [{ id: '1' }, { id: '2' }, { id: '3' }]
    render(<FileInput fileConfig={createFileConfig({ number_limits: 3 })} />)

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(input.disabled).toBe(true)
  })

  it('should not be disabled when file limit is not reached', () => {
    mockFiles = [{ id: '1' }]
    render(<FileInput fileConfig={createFileConfig({ number_limits: 3 })} />)

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(input.disabled).toBe(false)
  })

  it('should call handleLocalFileUpload when files are selected', () => {
    render(<FileInput fileConfig={createFileConfig()} />)

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['content'], 'test.jpg', { type: 'image/jpeg' })
    fireEvent.change(input, { target: { files: [file] } })

    expect(mockHandleLocalFileUpload).toHaveBeenCalledWith(file)
  })

  it('should respect number_limits when uploading multiple files', () => {
    mockFiles = [{ id: '1' }, { id: '2' }]
    render(<FileInput fileConfig={createFileConfig({ number_limits: 3 })} />)

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
    render(<FileInput fileConfig={createFileConfig({ number_limits: undefined })} />)

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['content'], 'test.jpg', { type: 'image/jpeg' })
    fireEvent.change(input, { target: { files: [file] } })

    expect(mockHandleLocalFileUpload).toHaveBeenCalledWith(file)
  })

  it('should clear input value on click', () => {
    render(<FileInput fileConfig={createFileConfig()} />)

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    Object.defineProperty(input, 'value', { writable: true, value: 'some-file' })
    fireEvent.click(input)

    expect(input.value).toBe('')
  })
})
