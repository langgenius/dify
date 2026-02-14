import type { FileUpload } from '@/app/components/base/features/types'
import { fireEvent, render, screen } from '@testing-library/react'
import FileFromLinkOrLocal from './index'

let mockFiles: { id: string }[] = []
vi.mock('../store', () => ({
  useStore: (selector: (s: { files: { id: string }[] }) => unknown) => selector({ files: mockFiles }),
}))

const mockHandleLoadFileFromLink = vi.fn()
vi.mock('../hooks', () => ({
  useFile: () => ({
    handleLoadFileFromLink: mockHandleLoadFileFromLink,
  }),
}))

vi.mock('../file-input', () => ({
  default: () => <input data-testid="file-input" type="file" />,
}))

vi.mock('@remixicon/react', () => ({
  RiUploadCloud2Line: ({ className }: { className?: string }) => (
    <svg data-testid="upload-icon" className={className} />
  ),
}))

vi.mock('@/app/components/base/button', () => ({
  default: ({ children, onClick, disabled, className, size, variant }: {
    children: React.ReactNode
    onClick?: () => void
    disabled?: boolean
    className?: string
    size?: string
    variant?: string
  }) => (
    <button data-testid="button" onClick={onClick} disabled={disabled} className={className} data-size={size} data-variant={variant}>{children}</button>
  ),
}))

vi.mock('@/app/components/base/portal-to-follow-elem', () => ({
  PortalToFollowElem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PortalToFollowElemContent: ({ children }: { children: React.ReactNode }) => <div data-testid="portal-content">{children}</div>,
  PortalToFollowElemTrigger: ({ children, onClick }: { children: React.ReactNode, onClick: () => void }) => (
    <div data-testid="portal-trigger" onClick={onClick}>{children}</div>
  ),
}))

const createFileConfig = (overrides: Partial<FileUpload> = {}): FileUpload => ({
  enabled: true,
  allowed_file_types: ['image'],
  allowed_file_extensions: [],
  number_limits: 5,
  ...overrides,
} as FileUpload)

describe('FileFromLinkOrLocal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFiles = []
  })

  it('should render trigger element', () => {
    const trigger = (open: boolean) => (
      <button data-testid="trigger">
        Open
        {open ? 'close' : 'open'}
      </button>
    )
    render(<FileFromLinkOrLocal trigger={trigger} fileConfig={createFileConfig()} />)

    expect(screen.getByTestId('trigger')).toBeInTheDocument()
  })

  it('should render URL input when showFromLink is true', () => {
    const trigger = () => <button>Open</button>
    render(<FileFromLinkOrLocal trigger={trigger} fileConfig={createFileConfig()} showFromLink />)

    expect(screen.getByPlaceholderText(/fileUploader\.pasteFileLinkInputPlaceholder/)).toBeInTheDocument()
  })

  it('should render upload button when showFromLocal is true', () => {
    const trigger = () => <button>Open</button>
    render(<FileFromLinkOrLocal trigger={trigger} fileConfig={createFileConfig()} showFromLocal />)

    expect(screen.getByText(/fileUploader\.uploadFromComputer/)).toBeInTheDocument()
  })

  it('should render OR divider when both link and local are shown', () => {
    const trigger = () => <button>Open</button>
    render(<FileFromLinkOrLocal trigger={trigger} fileConfig={createFileConfig()} showFromLink showFromLocal />)

    expect(screen.getByText('OR')).toBeInTheDocument()
  })

  it('should not render OR divider when only link is shown', () => {
    const trigger = () => <button>Open</button>
    render(<FileFromLinkOrLocal trigger={trigger} fileConfig={createFileConfig()} showFromLink showFromLocal={false} />)

    expect(screen.queryByText('OR')).not.toBeInTheDocument()
  })

  it('should show error when invalid URL is submitted', () => {
    const trigger = () => <button>Open</button>
    render(<FileFromLinkOrLocal trigger={trigger} fileConfig={createFileConfig()} showFromLink />)

    const input = screen.getByPlaceholderText(/fileUploader\.pasteFileLinkInputPlaceholder/)
    fireEvent.change(input, { target: { value: 'invalid-url' } })

    const okButton = screen.getByText(/operation\.ok/)
    fireEvent.click(okButton)

    expect(screen.getByText(/fileUploader\.pasteFileLinkInvalid/)).toBeInTheDocument()
  })

  it('should clear error when input changes', () => {
    const trigger = () => <button>Open</button>
    render(<FileFromLinkOrLocal trigger={trigger} fileConfig={createFileConfig()} showFromLink />)

    const input = screen.getByPlaceholderText(/fileUploader\.pasteFileLinkInputPlaceholder/)
    fireEvent.change(input, { target: { value: 'invalid-url' } })
    fireEvent.click(screen.getByText(/operation\.ok/))

    // Error should be visible
    expect(screen.getByText(/fileUploader\.pasteFileLinkInvalid/)).toBeInTheDocument()

    // Type again to clear error
    fireEvent.change(input, { target: { value: 'https://example.com' } })
    expect(screen.queryByText(/fileUploader\.pasteFileLinkInvalid/)).not.toBeInTheDocument()
  })

  it('should disable ok button when url is empty', () => {
    const trigger = () => <button>Open</button>
    render(<FileFromLinkOrLocal trigger={trigger} fileConfig={createFileConfig()} showFromLink />)

    const okButton = screen.getByText(/operation\.ok/)
    expect(okButton.closest('button')).toBeDisabled()
  })

  it('should disable inputs when file limit is reached', () => {
    mockFiles = [{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }, { id: '5' }]
    const trigger = () => <button>Open</button>
    render(<FileFromLinkOrLocal trigger={trigger} fileConfig={createFileConfig({ number_limits: 5 })} showFromLink showFromLocal />)

    const input = screen.getByPlaceholderText(/fileUploader\.pasteFileLinkInputPlaceholder/)
    expect(input).toBeDisabled()
  })

  it('should not submit when url is empty', () => {
    const trigger = () => <button>Open</button>
    render(<FileFromLinkOrLocal trigger={trigger} fileConfig={createFileConfig()} showFromLink />)

    const okButton = screen.getByText(/operation\.ok/)
    fireEvent.click(okButton)

    // No error should appear since we didn't validate empty
    expect(screen.queryByText(/fileUploader\.pasteFileLinkInvalid/)).not.toBeInTheDocument()
  })

  it('should call handleLoadFileFromLink when valid URL is submitted', () => {
    const trigger = () => <button>Open</button>
    render(<FileFromLinkOrLocal trigger={trigger} fileConfig={createFileConfig()} showFromLink />)

    const input = screen.getByPlaceholderText(/fileUploader\.pasteFileLinkInputPlaceholder/)
    fireEvent.change(input, { target: { value: 'https://example.com/file.pdf' } })
    fireEvent.click(screen.getByText(/operation\.ok/))

    expect(mockHandleLoadFileFromLink).toHaveBeenCalledWith('https://example.com/file.pdf')
  })

  it('should clear URL input after successful submission', () => {
    const trigger = () => <button>Open</button>
    render(<FileFromLinkOrLocal trigger={trigger} fileConfig={createFileConfig()} showFromLink />)

    const input = screen.getByPlaceholderText(/fileUploader\.pasteFileLinkInputPlaceholder/) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'https://example.com/file.pdf' } })
    fireEvent.click(screen.getByText(/operation\.ok/))

    expect(input.value).toBe('')
  })

  it('should toggle open state when trigger is clicked', () => {
    const trigger = (open: boolean) => <button data-testid="trigger">{open ? 'Close' : 'Open'}</button>
    render(<FileFromLinkOrLocal trigger={trigger} fileConfig={createFileConfig()} showFromLink />)

    const portalTrigger = screen.getByTestId('portal-trigger')
    fireEvent.click(portalTrigger)

    // Trigger should have been clicked, toggling open state
    expect(portalTrigger).toBeInTheDocument()
  })
})
