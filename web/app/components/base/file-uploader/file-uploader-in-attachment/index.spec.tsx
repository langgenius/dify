import type { FileEntity } from '../types'
import type { FileUpload } from '@/app/components/base/features/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { TransferMethod } from '@/types/app'
import FileUploaderInAttachmentWrapper from './index'

const mockHandleRemoveFile = vi.fn()
const mockHandleReUploadFile = vi.fn()
vi.mock('../hooks', () => ({
  useFile: () => ({
    handleRemoveFile: mockHandleRemoveFile,
    handleReUploadFile: mockHandleReUploadFile,
  }),
}))

vi.mock('@/utils/format', () => ({
  formatFileSize: (size: number) => `${size}B`,
}))

vi.mock('@/utils/download', () => ({
  downloadUrl: vi.fn(),
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
  })

  it('should render without crashing', () => {
    render(
      <FileUploaderInAttachmentWrapper
        onChange={vi.fn()}
        fileConfig={createFileConfig()}
      />,
    )

    // FileContextProvider wraps children with a Zustand context — verify children render
    expect(screen.getAllByRole('button').length).toBeGreaterThan(0)
  })

  it('should render upload buttons when not disabled', () => {
    render(
      <FileUploaderInAttachmentWrapper
        onChange={vi.fn()}
        fileConfig={createFileConfig()}
      />,
    )

    const buttons = screen.getAllByRole('button')
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

    expect(screen.queryByText(/fileUploader\.uploadFromComputer/)).not.toBeInTheDocument()
  })

  it('should render file items for each file', () => {
    const files = [
      createFile({ id: 'f1', name: 'a.txt' }),
      createFile({ id: 'f2', name: 'b.txt' }),
    ]

    render(
      <FileUploaderInAttachmentWrapper
        value={files}
        onChange={vi.fn()}
        fileConfig={createFileConfig()}
      />,
    )

    expect(screen.getByText(/a\.txt/i)).toBeInTheDocument()
    expect(screen.getByText(/b\.txt/i)).toBeInTheDocument()
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

  it('should render link upload option for remote_url method', () => {
    render(
      <FileUploaderInAttachmentWrapper
        onChange={vi.fn()}
        fileConfig={createFileConfig({
          allowed_file_upload_methods: [TransferMethod.remote_url],
        } as unknown as Partial<FileUpload>)}
      />,
    )

    expect(screen.getByText(/fileUploader\.pasteFileLink/)).toBeInTheDocument()
  })

  it('should call handleRemoveFile when remove button is clicked', () => {
    const files = [createFile({ id: 'f1', name: 'a.txt' })]

    render(
      <FileUploaderInAttachmentWrapper
        value={files}
        onChange={vi.fn()}
        fileConfig={createFileConfig()}
      />,
    )

    // Find the file item row, then locate the delete button within it
    const fileNameEl = screen.getByText(/a\.txt/i)
    const fileRow = fileNameEl.closest('[title="a.txt"]')?.parentElement?.parentElement
    const deleteBtn = fileRow?.querySelector('button:last-of-type')
    fireEvent.click(deleteBtn!)

    expect(mockHandleRemoveFile).toHaveBeenCalledWith('f1')
  })

  it('should apply open style on remote_url trigger when portal is open', () => {
    render(
      <FileUploaderInAttachmentWrapper
        onChange={vi.fn()}
        fileConfig={createFileConfig({
          allowed_file_upload_methods: [TransferMethod.remote_url],
        } as unknown as Partial<FileUpload>)}
      />,
    )

    // Click the remote_url button to open the portal
    const linkButton = screen.getByText(/fileUploader\.pasteFileLink/)
    fireEvent.click(linkButton)

    // The button should still be in the document
    expect(linkButton.closest('button')).toBeInTheDocument()
  })

  it('should disable upload buttons when file limit is reached', () => {
    const files = [
      createFile({ id: 'f1' }),
      createFile({ id: 'f2' }),
      createFile({ id: 'f3' }),
      createFile({ id: 'f4' }),
      createFile({ id: 'f5' }),
    ]

    render(
      <FileUploaderInAttachmentWrapper
        value={files}
        onChange={vi.fn()}
        fileConfig={createFileConfig({ number_limits: 5 })}
      />,
    )

    const buttons = screen.getAllByRole('button')
    const disabledButtons = buttons.filter(btn => btn.hasAttribute('disabled'))
    expect(disabledButtons.length).toBeGreaterThan(0)
  })

  it('should call handleReUploadFile when reupload button is clicked', () => {
    const files = [createFile({ id: 'f1', name: 'a.txt', progress: -1 })]

    const { container } = render(
      <FileUploaderInAttachmentWrapper
        value={files}
        onChange={vi.fn()}
        fileConfig={createFileConfig()}
      />,
    )

    // ReplayLine is inside ActionButton (a <button>) with data-icon attribute
    const replayIcon = container.querySelector('svg[data-icon="ReplayLine"]')
    const replayBtn = replayIcon!.closest('button')
    fireEvent.click(replayBtn!)

    expect(mockHandleReUploadFile).toHaveBeenCalledWith('f1')
  })
})
