import type { FileEntity } from './types'
import { fireEvent, render, screen } from '@testing-library/react'
import { TransferMethod } from '@/types/app'
import FileListInLog from './file-list-in-log'

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

    expect(screen.getByText(/runDetail\.fileListDetail/)).toBeInTheDocument()

    const detailLink = screen.getByText(/runDetail\.fileListDetail/)
    fireEvent.click(detailLink.parentElement!)

    expect(screen.getByText(/runDetail\.fileListLabel/)).toBeInTheDocument()
  })

  it('should render image files with an img element in collapsed view', () => {
    const fileList = [{
      varName: 'files',
      list: [createFile({
        name: 'photo.png',
        supportFileType: 'image',
        url: 'https://example.com/photo.png',
      })],
    }]
    render(<FileListInLog fileList={fileList} />)

    const img = screen.getByRole('img')
    expect(img).toBeInTheDocument()
    expect(img).toHaveAttribute('src', 'https://example.com/photo.png')
  })

  it('should render non-image files with an SVG icon in collapsed view', () => {
    const fileList = [{
      varName: 'files',
      list: [createFile({
        name: 'doc.pdf',
        supportFileType: 'document',
      })],
    }]
    render(<FileListInLog fileList={fileList} />)

    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('should render file details in expanded view', () => {
    const file = createFile({ name: 'report.txt' })
    const fileList = [{ varName: 'files', list: [file] }]
    render(<FileListInLog fileList={fileList} isExpanded />)

    expect(screen.getByText('report.txt')).toBeInTheDocument()
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

  it('should render image file with empty url when both base64Url and url are undefined', () => {
    const fileList = [{
      varName: 'files',
      list: [createFile({
        name: 'photo.png',
        supportFileType: 'image',
        base64Url: undefined,
        url: undefined,
      })],
    }]
    render(<FileListInLog fileList={fileList} />)

    const img = screen.getByRole('img')
    expect(img).toBeInTheDocument()
  })

  it('should collapse when label is clicked in expanded view', () => {
    const fileList = [{ varName: 'files', list: [createFile()] }]
    render(<FileListInLog fileList={fileList} isExpanded />)

    const label = screen.getByText(/runDetail\.fileListLabel/)
    fireEvent.click(label)

    expect(screen.getByText(/runDetail\.fileListDetail/)).toBeInTheDocument()
  })
})
