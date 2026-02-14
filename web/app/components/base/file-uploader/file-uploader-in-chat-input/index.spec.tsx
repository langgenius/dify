import type { FileUpload } from '@/app/components/base/features/types'
import { render, screen } from '@testing-library/react'
import FileUploaderInChatInput from './index'

vi.mock('@remixicon/react', () => ({
  RiAttachmentLine: ({ className }: { className?: string }) => (
    <svg data-testid="attachment-icon" className={className} />
  ),
}))

vi.mock('@/app/components/base/action-button', () => ({
  default: ({ children, disabled, className, size }: {
    children: React.ReactNode
    disabled?: boolean
    className?: string
    size?: string
  }) => (
    <button data-testid="action-button" disabled={disabled} className={className} data-size={size}>{children}</button>
  ),
}))

vi.mock('@/types/app', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/types/app')>()
  return {
    ...actual,
    TransferMethod: {
      local_file: 'local_file',
      remote_url: 'remote_url',
    },
  }
})

vi.mock('../file-from-link-or-local', () => ({
  default: ({ trigger, showFromLocal, showFromLink }: {
    trigger: (open: boolean) => React.ReactNode
    showFromLocal?: boolean
    showFromLink?: boolean
  }) => (
    <div data-testid="file-from-link-or-local" data-local={showFromLocal} data-link={showFromLink}>
      {trigger(false)}
    </div>
  ),
}))

const createFileConfig = (overrides: Partial<FileUpload> = {}): FileUpload => ({
  enabled: true,
  allowed_file_types: ['image'],
  allowed_file_upload_methods: ['local_file', 'remote_url'],
  allowed_file_extensions: [],
  number_limits: 5,
  ...overrides,
} as unknown as FileUpload)

describe('FileUploaderInChatInput', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render attachment icon', () => {
    render(<FileUploaderInChatInput fileConfig={createFileConfig()} />)

    expect(screen.getByTestId('attachment-icon')).toBeInTheDocument()
  })

  it('should render FileFromLinkOrLocal when not readonly', () => {
    render(<FileUploaderInChatInput fileConfig={createFileConfig()} />)

    expect(screen.getByTestId('file-from-link-or-local')).toBeInTheDocument()
  })

  it('should render only the trigger button when readonly', () => {
    render(<FileUploaderInChatInput fileConfig={createFileConfig()} readonly />)

    expect(screen.queryByTestId('file-from-link-or-local')).not.toBeInTheDocument()
    expect(screen.getByTestId('action-button')).toBeDisabled()
  })

  it('should pass showFromLocal based on allowed_file_upload_methods', () => {
    render(
      <FileUploaderInChatInput fileConfig={createFileConfig({
        allowed_file_upload_methods: ['local_file'],
      } as unknown as Partial<FileUpload>)}
      />,
    )

    const wrapper = screen.getByTestId('file-from-link-or-local')
    expect(wrapper).toHaveAttribute('data-local', 'true')
  })

  it('should pass showFromLink based on allowed_file_upload_methods', () => {
    render(
      <FileUploaderInChatInput fileConfig={createFileConfig({
        allowed_file_upload_methods: ['remote_url'],
      } as unknown as Partial<FileUpload>)}
      />,
    )

    const wrapper = screen.getByTestId('file-from-link-or-local')
    expect(wrapper).toHaveAttribute('data-link', 'true')
  })
})
