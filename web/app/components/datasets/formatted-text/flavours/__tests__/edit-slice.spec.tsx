import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Capture the onOpenChange callback to simulate hover interactions
let capturedOnOpenChange: ((open: boolean) => void) | null = null

vi.mock('@floating-ui/react', () => ({
  autoUpdate: vi.fn(),
  flip: vi.fn(),
  shift: vi.fn(),
  offset: vi.fn(),
  FloatingFocusManager: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="floating-focus-manager">
      {children}
    </div>
  ),
  useFloating: ({ onOpenChange }: { onOpenChange?: (open: boolean) => void } = {}) => {
    capturedOnOpenChange = onOpenChange ?? null
    return {
      refs: { setReference: vi.fn(), setFloating: vi.fn() },
      floatingStyles: {},
      context: { open: false, onOpenChange: vi.fn(), refs: { domReference: { current: null } }, nodeId: undefined },
    }
  },
  useHover: () => ({}),
  useDismiss: () => ({}),
  useRole: () => ({}),
  useInteractions: () => ({
    getReferenceProps: () => ({}),
    getFloatingProps: () => ({}),
  }),
}))

vi.mock('@/app/components/base/action-button', () => {
  const comp = ({ children, onClick }: { children: React.ReactNode, onClick: () => void }) => (
    <button data-testid="action-button" onClick={onClick}>{children}</button>
  )
  return {
    default: comp,
    ActionButtonState: { Destructive: 'destructive' },
  }
})

const { EditSlice } = await import('../edit-slice')

// Helper to find divider span (zero-width space)
const findDividerSpan = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('span')).find(s => s.textContent?.includes('\u200B'))

describe('EditSlice', () => {
  const defaultProps = {
    label: 'S1',
    text: 'Sample text content',
    onDelete: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    capturedOnOpenChange = null
  })

  // ---- Rendering Tests ----
  it('should render label and text', () => {
    render(<EditSlice {...defaultProps} />)
    expect(screen.getByText('S1')).toBeInTheDocument()
    expect(screen.getByText('Sample text content')).toBeInTheDocument()
  })

  it('should render divider by default', () => {
    const { container } = render(<EditSlice {...defaultProps} />)
    expect(findDividerSpan(container)).toBeTruthy()
  })

  it('should not render divider when showDivider is false', () => {
    const { container } = render(<EditSlice {...defaultProps} showDivider={false} />)
    expect(findDividerSpan(container)).toBeFalsy()
  })

  // ---- Class Name Tests ----
  it('should apply custom labelClassName', () => {
    render(<EditSlice {...defaultProps} labelClassName="label-extra" />)
    const labelEl = screen.getByText('S1').parentElement
    expect(labelEl).toHaveClass('label-extra')
  })

  it('should apply custom contentClassName', () => {
    render(<EditSlice {...defaultProps} contentClassName="content-extra" />)
    expect(screen.getByText('Sample text content')).toHaveClass('content-extra')
  })

  it('should apply labelInnerClassName to SliceLabel inner span', () => {
    render(<EditSlice {...defaultProps} labelInnerClassName="inner-label" />)
    expect(screen.getByText('S1')).toHaveClass('inner-label')
  })

  it('should apply custom className to wrapper', () => {
    render(<EditSlice {...defaultProps} data-testid="edit-slice" className="custom-slice" />)
    expect(screen.getByTestId('edit-slice')).toHaveClass('custom-slice')
  })

  it('should pass rest props to wrapper', () => {
    render(<EditSlice {...defaultProps} data-testid="edit-slice" />)
    expect(screen.getByTestId('edit-slice')).toBeInTheDocument()
  })

  // ---- Floating UI / Delete Button Tests ----
  it('should not show delete button when floating is closed', () => {
    render(<EditSlice {...defaultProps} />)
    expect(screen.queryByTestId('floating-focus-manager')).not.toBeInTheDocument()
  })

  it('should show delete button when onOpenChange triggers open', () => {
    render(<EditSlice {...defaultProps} />)
    act(() => {
      capturedOnOpenChange?.(true)
    })
    expect(screen.getByTestId('floating-focus-manager')).toBeInTheDocument()
  })

  it('should call onDelete when delete button is clicked', () => {
    const onDelete = vi.fn()
    render(<EditSlice {...defaultProps} onDelete={onDelete} />)
    act(() => {
      capturedOnOpenChange?.(true)
    })
    fireEvent.click(screen.getByRole('button'))
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('should close floating after delete button is clicked', () => {
    render(<EditSlice {...defaultProps} />)
    act(() => {
      capturedOnOpenChange?.(true)
    })
    expect(screen.getByTestId('floating-focus-manager')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button'))
    expect(screen.queryByTestId('floating-focus-manager')).not.toBeInTheDocument()
  })

  it('should stop event propagation on delete click', () => {
    const parentClick = vi.fn()
    render(
      <div onClick={parentClick}>
        <EditSlice {...defaultProps} />
      </div>,
    )
    act(() => {
      capturedOnOpenChange?.(true)
    })
    fireEvent.click(screen.getByRole('button'))
    expect(parentClick).not.toHaveBeenCalled()
  })

  // ---- Destructive Hover Style Tests ----
  it('should apply destructive styles when hovering on delete button container', async () => {
    render(<EditSlice {...defaultProps} />)
    act(() => {
      capturedOnOpenChange?.(true)
    })
    const floatingSpan = screen.getByTestId('floating-focus-manager').firstElementChild as HTMLElement
    fireEvent.mouseEnter(floatingSpan)

    await waitFor(() => {
      const labelEl = screen.getByText('S1').parentElement
      expect(labelEl).toHaveClass('!bg-state-destructive-solid')
      expect(labelEl).toHaveClass('!text-text-primary-on-surface')
    })
    expect(screen.getByText('Sample text content')).toHaveClass('!bg-state-destructive-hover-alt')
  })

  it('should remove destructive styles when mouse leaves delete button container', async () => {
    render(<EditSlice {...defaultProps} />)
    act(() => {
      capturedOnOpenChange?.(true)
    })
    const floatingSpan = screen.getByTestId('floating-focus-manager').firstElementChild as HTMLElement
    fireEvent.mouseEnter(floatingSpan)

    await waitFor(() => {
      expect(screen.getByText('S1').parentElement).toHaveClass('!bg-state-destructive-solid')
    })

    fireEvent.mouseLeave(floatingSpan)

    await waitFor(() => {
      expect(screen.getByText('S1').parentElement).not.toHaveClass('!bg-state-destructive-solid')
      expect(screen.getByText('Sample text content')).not.toHaveClass('!bg-state-destructive-hover-alt')
    })
  })
})
