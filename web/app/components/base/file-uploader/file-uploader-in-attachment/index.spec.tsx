import type { FileEntity } from '../types'
import type { FileUpload } from '@/app/components/base/features/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { TransferMethod } from '@/types/app'
import FileUploaderInAttachmentWrapper from './index'

let mockFiles: FileEntity[] = []
vi.mock('../store', () => ({
  FileContextProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="file-context-provider">{children}</div>,
  useStore: (selector: (s: { files: FileEntity[] }) => unknown) => selector({ files: mockFiles }),
}))

const mockHandleRemoveFile = vi.fn()
const mockHandleReUploadFile = vi.fn()
vi.mock('../hooks', () => ({
  useFile: () => ({
    handleRemoveFile: mockHandleRemoveFile,
    handleReUploadFile: mockHandleReUploadFile,
  }),
}))

vi.mock('../file-input', () => ({
  default: () => <input data-testid="file-input" type="file" />,
}))

vi.mock('../file-from-link-or-local', () => ({
  default: ({ showFromLocal }: { showFromLocal?: boolean }) => (
    <div data-testid="file-from-link-or-local" data-local={showFromLocal} />
  ),
}))

vi.mock('./file-item', () => ({
  default: ({ file, onRemove, onReUpload }: {
    file: FileEntity
    onRemove?: () => void
    onReUpload?: () => void
  }) => (
    <div data-testid="file-item" data-name={file.name}>
      {onRemove && <button data-testid={`remove-${file.id}`} onClick={onRemove}>Remove</button>}
      {onReUpload && <button data-testid={`reupload-${file.id}`} onClick={onReUpload}>ReUpload</button>}
    </div>
  ),
}))

vi.mock('@remixicon/react', () => ({
  RiLink: ({ className }: { className?: string }) => <svg data-testid="link-icon" className={className} />,
  RiUploadCloud2Line: ({ className }: { className?: string }) => <svg data-testid="upload-icon" className={className} />,
}))

vi.mock('@/app/components/base/button', () => ({
  default: ({ children, disabled, className, variant }: {
    children: React.ReactNode
    disabled?: boolean
    className?: string
    variant?: string
  }) => (
    <button data-testid="upload-button" disabled={disabled} className={className} data-variant={variant}>{children}</button>
  ),
}))

const createFileConfig = (overrides: Partial<FileUpload> = {}): FileUpload => ({
  enabled: true,
  allowed_file_types: ['image'],
  allowed_file_upload_methods: [TransferMethod.local_file, TransferMethod.remote_url],
  allowed_file_extensions: [],
  number_limits: 5,
  ...overrides,
} as unknown as FileUpload)

const createFile = (overrides: Partial<FileEntity> = {}): FileEntity => ({
  id: 'file-1',
  name: 'test.txt',
  size: 1024,
  type: 'text/plain',
  progress: 100,
  transferMethod: TransferMethod.local_file,
  supportFileType: 'document',
  ...overrides,
})

describe('FileUploaderInAttachmentWrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFiles = []
  })

  it('should render FileContextProvider', () => {
    render(
      <FileUploaderInAttachmentWrapper
        onChange={vi.fn()}
        fileConfig={createFileConfig()}
      />,
    )

    expect(screen.getByTestId('file-context-provider')).toBeInTheDocument()
  })

  it('should render upload buttons when not disabled', () => {
    render(
      <FileUploaderInAttachmentWrapper
        onChange={vi.fn()}
        fileConfig={createFileConfig()}
      />,
    )

    const buttons = screen.getAllByTestId('upload-button')
    expect(buttons.length).toBeGreaterThan(0)
  })

  it('should not render upload buttons when disabled', () => {
    render(
      <FileUploaderInAttachmentWrapper
        onChange={vi.fn()}
        fileConfig={createFileConfig()}
        isDisabled
      />,
    )

    // Upload buttons for local/remote should not be shown
    expect(screen.queryByText(/fileUploader\.uploadFromComputer/)).not.toBeInTheDocument()
  })

  it('should render file items for each file', () => {
    mockFiles = [
      createFile({ id: 'f1', name: 'a.txt' }),
      createFile({ id: 'f2', name: 'b.txt' }),
    ]

    render(
      <FileUploaderInAttachmentWrapper
        onChange={vi.fn()}
        fileConfig={createFileConfig()}
      />,
    )

    const fileItems = screen.getAllByTestId('file-item')
    expect(fileItems).toHaveLength(2)
  })

  it('should render local upload button for local_file method', () => {
    render(
      <FileUploaderInAttachmentWrapper
        onChange={vi.fn()}
        fileConfig={createFileConfig({
          allowed_file_upload_methods: [TransferMethod.local_file],
        } as unknown as Partial<FileUpload>)}
      />,
    )

    expect(screen.getByText(/fileUploader\.uploadFromComputer/)).toBeInTheDocument()
  })

  it('should render FileFromLinkOrLocal for remote_url method', () => {
    render(
      <FileUploaderInAttachmentWrapper
        onChange={vi.fn()}
        fileConfig={createFileConfig({
          allowed_file_upload_methods: [TransferMethod.remote_url],
        } as unknown as Partial<FileUpload>)}
      />,
    )

    expect(screen.getByTestId('file-from-link-or-local')).toBeInTheDocument()
  })

  it('should call handleRemoveFile when remove button is clicked', () => {
    mockFiles = [createFile({ id: 'f1', name: 'a.txt' })]

    render(
      <FileUploaderInAttachmentWrapper
        onChange={vi.fn()}
        fileConfig={createFileConfig()}
      />,
    )

    fireEvent.click(screen.getByTestId('remove-f1'))

    expect(mockHandleRemoveFile).toHaveBeenCalledWith('f1')
  })

  it('should call handleReUploadFile when reupload button is clicked', () => {
    mockFiles = [createFile({ id: 'f1', name: 'a.txt' })]

    render(
      <FileUploaderInAttachmentWrapper
        onChange={vi.fn()}
        fileConfig={createFileConfig()}
      />,
    )

    fireEvent.click(screen.getByTestId('reupload-f1'))

    expect(mockHandleReUploadFile).toHaveBeenCalledWith('f1')
  })
})
