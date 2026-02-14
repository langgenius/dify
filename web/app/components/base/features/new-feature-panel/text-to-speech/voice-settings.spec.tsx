import { fireEvent, render, screen } from '@testing-library/react'
import VoiceSettings from './voice-settings'

vi.mock('@/app/components/base/portal-to-follow-elem', () => ({
  PortalToFollowElem: ({ children, open }: { children: React.ReactNode, open: boolean }) => <div data-testid="portal-elem" data-open={open}>{children}</div>,
  PortalToFollowElemTrigger: ({ children, onClick, className }: { children: React.ReactNode, onClick: () => void, className?: string }) => (
    <div data-testid="trigger" className={className} onClick={onClick}>{children}</div>
  ),
  PortalToFollowElemContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="portal-content">{children}</div>
  ),
}))

vi.mock('@/app/components/base/features/new-feature-panel/text-to-speech/param-config-content', () => ({
  default: ({ onClose, onChange }: { onClose: () => void, onChange?: () => void }) => (
    <div data-testid="param-config">
      <button data-testid="close-btn" onClick={onClose}>Close</button>
      <button data-testid="change-btn" onClick={onChange}>Change</button>
    </div>
  ),
}))

describe('VoiceSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render children in trigger', () => {
    render(
      <VoiceSettings open={false} onOpen={vi.fn()}>
        <button>Settings</button>
      </VoiceSettings>,
    )

    expect(screen.getByText('Settings')).toBeInTheDocument()
  })

  it('should render ParamConfigContent in portal', () => {
    render(
      <VoiceSettings open={true} onOpen={vi.fn()}>
        <button>Settings</button>
      </VoiceSettings>,
    )

    expect(screen.getByTestId('param-config')).toBeInTheDocument()
  })

  it('should call onOpen with toggle function when trigger is clicked', () => {
    const onOpen = vi.fn()
    render(
      <VoiceSettings open={false} onOpen={onOpen}>
        <button>Settings</button>
      </VoiceSettings>,
    )

    fireEvent.click(screen.getByTestId('trigger'))

    expect(onOpen).toHaveBeenCalled()
    // The toggle function should flip the open state
    const toggleFn = onOpen.mock.calls[0][0]
    expect(typeof toggleFn).toBe('function')
    expect(toggleFn(false)).toBe(true)
    expect(toggleFn(true)).toBe(false)
  })

  it('should not call onOpen when disabled and trigger is clicked', () => {
    const onOpen = vi.fn()
    render(
      <VoiceSettings open={false} onOpen={onOpen} disabled>
        <button>Settings</button>
      </VoiceSettings>,
    )

    fireEvent.click(screen.getByTestId('trigger'))

    expect(onOpen).not.toHaveBeenCalled()
  })

  it('should call onOpen with false when close is clicked', () => {
    const onOpen = vi.fn()
    render(
      <VoiceSettings open={true} onOpen={onOpen}>
        <button>Settings</button>
      </VoiceSettings>,
    )

    fireEvent.click(screen.getByTestId('close-btn'))

    expect(onOpen).toHaveBeenCalledWith(false)
  })
})
