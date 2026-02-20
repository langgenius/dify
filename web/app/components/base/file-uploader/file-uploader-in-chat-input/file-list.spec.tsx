import type { FileEntity } from '../types'
import type { FileUpload } from '@/app/components/base/features/types'
import { render, screen } from '@testing-library/react'
import { TransferMethod } from '@/types/app'
import { FileContextProvider } from '../store'
import { FileList, FileListInChatInput } from './file-list'

vi.mock('../hooks', () => ({
  useFile: () => ({
    handleRemoveFile: vi.fn(),
    handleReUploadFile: vi.fn(),
  }),
}))

vi.mock('@/utils/format', () => ({
  formatFileSize: (size: number) => `${size}B`,
}))

vi.mock('@/utils/download', () => ({
  downloadUrl: vi.fn(),
}))

const createFile = (overrides: Partial<FileEntity> = {}): FileEntity => ({
  id: `file-${Math.random()}`,
  name: 'document.pdf',
  size: 1024,
  type: 'application/pdf',
  progress: 100,
  transferMethod: TransferMethod.local_file,
  supportFileType: 'document',
  ...overrides,
})

describe('FileList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render FileImageItem for image files', () => {
    const files = [createFile({
      name: 'photo.png',
      type: 'image/png',
      supportFileType: 'image',
      base64Url: 'data:image/png;base64,abc',
    })]
    render(<FileList files={files} />)

    expect(screen.getByRole('img')).toBeInTheDocument()
  })

  it('should render FileItem for non-image files', () => {
    const files = [createFile({
      name: 'document.pdf',
      supportFileType: 'document',
    })]
    render(<FileList files={files} />)

    expect(screen.getByText(/document\.pdf/i)).toBeInTheDocument()
  })

  it('should render both image and non-image files', () => {
    const files = [
      createFile({
        name: 'photo.png',
        type: 'image/png',
        supportFileType: 'image',
        base64Url: 'data:image/png;base64,abc',
      }),
      createFile({ name: 'doc.pdf', supportFileType: 'document' }),
    ]
    render(<FileList files={files} />)

    expect(screen.getByRole('img')).toBeInTheDocument()
    expect(screen.getByText(/doc\.pdf/i)).toBeInTheDocument()
  })

  it('should render empty list when no files', () => {
    const { container } = render(<FileList files={[]} />)

    expect(container.firstChild).toBeInTheDocument()
    expect(screen.queryAllByRole('img')).toHaveLength(0)
  })

  it('should apply custom className', () => {
    const { container } = render(<FileList files={[]} className="custom-class" />)

    expect(container.firstChild).toHaveClass('custom-class')
  })

  it('should render multiple files', () => {
    const files = [
      createFile({ name: 'a.pdf' }),
      createFile({ name: 'b.pdf' }),
      createFile({ name: 'c.pdf' }),
    ]
    render(<FileList files={files} />)

    expect(screen.getByText(/a\.pdf/i)).toBeInTheDocument()
    expect(screen.getByText(/b\.pdf/i)).toBeInTheDocument()
    expect(screen.getByText(/c\.pdf/i)).toBeInTheDocument()
  })
})

describe('FileListInChatInput', () => {
  let mockStoreFiles: FileEntity[] = []

  beforeEach(() => {
    vi.clearAllMocks()
    mockStoreFiles = []
  })

  it('should render FileList with files from store', () => {
    mockStoreFiles = [createFile({ name: 'test.pdf' })]
    const fileConfig = { enabled: true, allowed_file_types: ['document'] } as FileUpload

    render(
      <FileContextProvider value={mockStoreFiles}>
        <FileListInChatInput fileConfig={fileConfig} />
      </FileContextProvider>,
    )

    expect(screen.getByText(/test\.pdf/i)).toBeInTheDocument()
  })

  it('should render empty FileList when store has no files', () => {
    const fileConfig = { enabled: true, allowed_file_types: ['document'] } as FileUpload

    render(
      <FileContextProvider value={mockStoreFiles}>
        <FileListInChatInput fileConfig={fileConfig} />
      </FileContextProvider>,
    )

    expect(screen.queryAllByRole('img')).toHaveLength(0)
    expect(screen.queryByText(/\.pdf/i)).not.toBeInTheDocument()
  })
})
