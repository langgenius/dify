import { fireEvent, render, screen } from '@testing-library/react'
import FileUploadSettings from './setting-modal'

vi.mock('@/app/components/base/portal-to-follow-elem', () => ({
  PortalToFollowElem: ({ children, open }: { children: React.ReactNode, open: boolean }) => <div data-testid="portal-elem" data-open={open}>{children}</div>,
  PortalToFollowElemTrigger: ({ children, onClick, className }: { children: React.ReactNode, onClick: () => void, className?: string }) => (
    <div data-testid="trigger" className={className} onClick={onClick}>{children}</div>
  ),
  PortalToFollowElemContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="portal-content">{children}</div>
  ),
}))

vi.mock('@/app/components/base/features/new-feature-panel/file-upload/setting-content', () => ({
  default: ({ onClose, onChange, imageUpload }: { onClose: () => void, onChange?: () => void, imageUpload?: boolean }) => (
    <div data-testid="setting-content" data-image-upload={imageUpload}>
      <button data-testid="close-btn" onClick={onClose}>Close</button>
      <button data-testid="save-btn" onClick={onChange}>Save</button>
    </div>
  ),
}))

describe('FileUploadSettings (setting-modal)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render children in trigger', () => {
    render(
      <FileUploadSettings open={false} onOpen={vi.fn()}>
        <button>Upload Settings</button>
      </FileUploadSettings>,
    )

    expect(screen.getByText('Upload Settings')).toBeInTheDocument()
  })

  it('should render SettingContent in portal', () => {
    render(
      <FileUploadSettings open={true} onOpen={vi.fn()}>
        <button>Upload Settings</button>
      </FileUploadSettings>,
    )

    expect(screen.getByTestId('setting-content')).toBeInTheDocument()
  })

  it('should call onOpen with toggle function when trigger is clicked', () => {
    const onOpen = vi.fn()
    render(
      <FileUploadSettings open={false} onOpen={onOpen}>
        <button>Upload Settings</button>
      </FileUploadSettings>,
    )

    fireEvent.click(screen.getByTestId('trigger'))

    expect(onOpen).toHaveBeenCalled()
    // The toggle function should flip the open state
    const toggleFn = onOpen.mock.calls[0][0]
    expect(typeof toggleFn).toBe('function')
    expect(toggleFn(false)).toBe(true)
    expect(toggleFn(true)).toBe(false)
  })

  it('should not call onOpen when disabled', () => {
    const onOpen = vi.fn()
    render(
      <FileUploadSettings open={false} onOpen={onOpen} disabled>
        <button>Upload Settings</button>
      </FileUploadSettings>,
    )

    fireEvent.click(screen.getByTestId('trigger'))

    expect(onOpen).not.toHaveBeenCalled()
  })

  it('should call onOpen with false when close is clicked', () => {
    const onOpen = vi.fn()
    render(
      <FileUploadSettings open={true} onOpen={onOpen}>
        <button>Upload Settings</button>
      </FileUploadSettings>,
    )

    fireEvent.click(screen.getByTestId('close-btn'))

    expect(onOpen).toHaveBeenCalledWith(false)
  })

  it('should call onChange and close when save is clicked', () => {
    const onChange = vi.fn()
    const onOpen = vi.fn()
    render(
      <FileUploadSettings open={true} onOpen={onOpen} onChange={onChange}>
        <button>Upload Settings</button>
      </FileUploadSettings>,
    )

    fireEvent.click(screen.getByTestId('save-btn'))

    expect(onChange).toHaveBeenCalled()
    expect(onOpen).toHaveBeenCalledWith(false)
  })

  it('should pass imageUpload prop to SettingContent', () => {
    render(
      <FileUploadSettings open={true} onOpen={vi.fn()} imageUpload>
        <button>Upload Settings</button>
      </FileUploadSettings>,
    )

    expect(screen.getByTestId('setting-content')).toHaveAttribute('data-image-upload', 'true')
  })
})
