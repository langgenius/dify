import type { FileEntity } from '../types'
import type { FileUpload } from '@/app/components/base/features/types'
import { render, screen } from '@testing-library/react'
import { TransferMethod } from '@/types/app'
import { FileList, FileListInChatInput } from './file-list'

vi.mock('@/app/components/workflow/types', () => ({
  SupportUploadFileTypes: {
    image: 'image',
    document: 'document',
  },
  InputVarType: {},
}))

let mockStoreFiles: FileEntity[] = []
vi.mock('../store', () => ({
  useStore: (selector: (s: { files: FileEntity[] }) => unknown) => selector({ files: mockStoreFiles }),
}))

vi.mock('../hooks', () => ({
  useFile: () => ({
    handleRemoveFile: vi.fn(),
    handleReUploadFile: vi.fn(),
  }),
}))

vi.mock('./file-image-item', () => ({
  default: ({ file }: { file: FileEntity }) => (
    <div data-testid="file-image-item" data-name={file.name} />
  ),
}))

vi.mock('./file-item', () => ({
  default: ({ file }: { file: FileEntity }) => (
    <div data-testid="file-item" data-name={file.name} />
  ),
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
      supportFileType: 'image',
    })]
    render(<FileList files={files} />)

    expect(screen.getByTestId('file-image-item')).toBeInTheDocument()
  })

  it('should render FileItem for non-image files', () => {
    const files = [createFile({
      name: 'document.pdf',
      supportFileType: 'document',
    })]
    render(<FileList files={files} />)

    expect(screen.getByTestId('file-item')).toBeInTheDocument()
  })

  it('should render both image and non-image files', () => {
    const files = [
      createFile({ name: 'photo.png', supportFileType: 'image' }),
      createFile({ name: 'doc.pdf', supportFileType: 'document' }),
    ]
    render(<FileList files={files} />)

    expect(screen.getByTestId('file-image-item')).toBeInTheDocument()
    expect(screen.getByTestId('file-item')).toBeInTheDocument()
  })

  it('should render empty list when no files', () => {
    const { container } = render(<FileList files={[]} />)

    expect(container.querySelector('.flex.flex-wrap')).toBeInTheDocument()
    expect(screen.queryByTestId('file-item')).not.toBeInTheDocument()
    expect(screen.queryByTestId('file-image-item')).not.toBeInTheDocument()
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

    expect(screen.getAllByTestId('file-item')).toHaveLength(3)
  })
})

describe('FileListInChatInput', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStoreFiles = []
  })

  it('should render FileList with files from store', () => {
    mockStoreFiles = [createFile({ name: 'test.pdf' })]
    const fileConfig = { enabled: true, allowed_file_types: ['document'] } as FileUpload

    render(<FileListInChatInput fileConfig={fileConfig} />)

    expect(screen.getByTestId('file-item')).toBeInTheDocument()
  })

  it('should render empty FileList when store has no files', () => {
    const fileConfig = { enabled: true, allowed_file_types: ['document'] } as FileUpload

    render(<FileListInChatInput fileConfig={fileConfig} />)

    expect(screen.queryByTestId('file-item')).not.toBeInTheDocument()
  })
})
