import type { FileEntity } from './types'
import { fireEvent, render, screen } from '@testing-library/react'
import { TransferMethod } from '@/types/app'
import FileListInLog from './file-list-in-log'

vi.mock('@remixicon/react', () => ({
  RiArrowRightSLine: ({ className }: { className?: string }) => (
    <svg data-testid="arrow-icon" className={className} />
  ),
  RiDeleteBinLine: () => <svg data-testid="delete-icon" />,
  RiDownloadLine: () => <svg data-testid="download-icon" />,
  RiEyeLine: () => <svg data-testid="eye-icon" />,
}))

vi.mock('@/app/components/base/tooltip', () => ({
  default: ({ children, popupContent }: { children: React.ReactNode, popupContent: string }) => (
    <div data-testid="tooltip" data-popup={popupContent}>{children}</div>
  ),
}))

vi.mock('@/app/components/workflow/types', () => ({
  SupportUploadFileTypes: {
    image: 'image',
    document: 'document',
  },
}))

vi.mock('./file-image-render', () => ({
  default: ({ imageUrl, className }: { imageUrl: string, className?: string }) => (
    <img data-testid="file-image-render" src={imageUrl} className={className} alt="file" />
  ),
}))

vi.mock('./file-type-icon', () => ({
  default: ({ type, size }: { type: string, size: string }) => (
    <span data-testid="file-type-icon" data-type={type} data-size={size} />
  ),
}))

vi.mock('./file-uploader-in-attachment/file-item', () => ({
  default: ({ file, showDeleteAction, showDownloadAction }: {
    file: FileEntity
    showDeleteAction: boolean
    showDownloadAction: boolean
  }) => (
    <div data-testid="file-item" data-name={file.name} data-delete={showDeleteAction} data-download={showDownloadAction} />
  ),
}))

vi.mock('./utils', () => ({
  getFileAppearanceType: (name: string) => {
    if (name.endsWith('.pdf'))
      return 'pdf'
    return 'document'
  },
}))

const createFile = (overrides: Partial<FileEntity> = {}): FileEntity => ({
  id: `file-${Math.random()}`,
  name: 'test.txt',
  size: 1024,
  type: 'text/plain',
  progress: 100,
  transferMethod: TransferMethod.local_file,
  supportFileType: 'document',
  ...overrides,
})

describe('FileListInLog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return null when fileList is empty', () => {
    const { container } = render(<FileListInLog fileList={[]} />)

    expect(container.firstChild).toBeNull()
  })

  it('should render collapsed view by default', () => {
    const fileList = [{ varName: 'files', list: [createFile()] }]
    render(<FileListInLog fileList={fileList} />)

    expect(screen.getByText(/runDetail\.fileListDetail/)).toBeInTheDocument()
  })

  it('should render expanded view when isExpanded is true', () => {
    const fileList = [{ varName: 'files', list: [createFile()] }]
    render(<FileListInLog fileList={fileList} isExpanded />)

    expect(screen.getByText(/runDetail\.fileListLabel/)).toBeInTheDocument()
    expect(screen.getByText('files')).toBeInTheDocument()
  })

  it('should toggle between collapsed and expanded on click', () => {
    const fileList = [{ varName: 'files', list: [createFile()] }]
    render(<FileListInLog fileList={fileList} />)

    // Initially collapsed - shows detail link
    expect(screen.getByText(/runDetail\.fileListDetail/)).toBeInTheDocument()

    // Click to expand
    const detailLink = screen.getByText(/runDetail\.fileListDetail/)
    fireEvent.click(detailLink.closest('div[class*="cursor-pointer"]')!)

    // Now expanded
    expect(screen.getByText(/runDetail\.fileListLabel/)).toBeInTheDocument()
  })

  it('should render image files with FileImageRender in collapsed view', () => {
    const fileList = [{
      varName: 'files',
      list: [createFile({
        name: 'photo.png',
        supportFileType: 'image',
        url: 'https://example.com/photo.png',
      })],
    }]
    render(<FileListInLog fileList={fileList} />)

    expect(screen.getByTestId('file-image-render')).toBeInTheDocument()
  })

  it('should render non-image files with FileTypeIcon in collapsed view', () => {
    const fileList = [{
      varName: 'files',
      list: [createFile({
        name: 'doc.pdf',
        supportFileType: 'document',
      })],
    }]
    render(<FileListInLog fileList={fileList} />)

    expect(screen.getByTestId('file-type-icon')).toBeInTheDocument()
  })

  it('should render FileItem components in expanded view', () => {
    const file = createFile()
    const fileList = [{ varName: 'files', list: [file] }]
    render(<FileListInLog fileList={fileList} isExpanded />)

    const fileItem = screen.getByTestId('file-item')
    expect(fileItem).toHaveAttribute('data-delete', 'false')
    expect(fileItem).toHaveAttribute('data-download', 'true')
  })

  it('should render multiple var groups in expanded view', () => {
    const fileList = [
      { varName: 'images', list: [createFile({ name: 'a.jpg' })] },
      { varName: 'documents', list: [createFile({ name: 'b.pdf' })] },
    ]
    render(<FileListInLog fileList={fileList} isExpanded />)

    expect(screen.getByText('images')).toBeInTheDocument()
    expect(screen.getByText('documents')).toBeInTheDocument()
  })

  it('should apply noBorder class when noBorder is true', () => {
    const fileList = [{ varName: 'files', list: [createFile()] }]
    const { container } = render(<FileListInLog fileList={fileList} noBorder />)

    expect(container.firstChild).not.toHaveClass('border-t')
  })

  it('should apply noPadding class when noPadding is true', () => {
    const fileList = [{ varName: 'files', list: [createFile()] }]
    const { container } = render(<FileListInLog fileList={fileList} noPadding />)

    expect(container.firstChild).toHaveClass('!p-0')
  })

  it('should collapse when label is clicked in expanded view', () => {
    const fileList = [{ varName: 'files', list: [createFile()] }]
    render(<FileListInLog fileList={fileList} isExpanded />)

    const label = screen.getByText(/runDetail\.fileListLabel/)
    fireEvent.click(label)

    // Should now show collapsed view
    expect(screen.getByText(/runDetail\.fileListDetail/)).toBeInTheDocument()
  })
})
