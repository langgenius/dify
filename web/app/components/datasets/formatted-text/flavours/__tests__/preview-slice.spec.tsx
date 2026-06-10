import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Capture the onOpenChange callback to simulate hover interactions
let capturedOnOpenChange: ((open: boolean) => void) | null = null

vi.mock('@floating-ui/react', () => ({
  autoUpdate: vi.fn(),
  flip: vi.fn(),
  shift: vi.fn(),
  inline: vi.fn(),
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

const { PreviewSlice } = await import('../preview-slice')

// Helper to find divider span (zero-width space)
const findDividerSpan = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('span')).find(s => s.textContent?.includes('\u200B'))

describe('PreviewSlice', () => {
  const defaultProps = {
    label: 'P1',
    text: 'Preview text',
    tooltip: 'Tooltip content',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    capturedOnOpenChange = null
  })

  // ---- Rendering Tests ----
  it('should render label and text', () => {
    render(<PreviewSlice {...defaultProps} />)
    expect(screen.getByText('P1')).toBeInTheDocument()
    expect(screen.getByText('Preview text')).toBeInTheDocument()
  })

  it('should not show tooltip by default', () => {
    render(<PreviewSlice {...defaultProps} />)
    expect(screen.queryByText('Tooltip content')).not.toBeInTheDocument()
  })

  it('should always render a divider', () => {
    const { container } = render(<PreviewSlice {...defaultProps} />)
    expect(findDividerSpan(container)).toBeTruthy()
  })

  // ---- Class Name Tests ----
  it('should apply custom className', () => {
    render(<PreviewSlice {...defaultProps} data-testid="preview-slice" className="preview-custom" />)
    expect(screen.getByTestId('preview-slice')).toHaveClass('preview-custom')
  })

  it('should apply labelInnerClassName to the label inner span', () => {
    render(<PreviewSlice {...defaultProps} labelInnerClassName="label-inner" />)
    expect(screen.getByText('P1')).toHaveClass('label-inner')
  })

  it('should pass rest props to wrapper', () => {
    render(<PreviewSlice {...defaultProps} data-testid="preview-slice" />)
    expect(screen.getByTestId('preview-slice')).toBeInTheDocument()
  })

  // ---- Tooltip Interaction Tests ----
  it('should show tooltip when onOpenChange triggers open', () => {
    render(<PreviewSlice {...defaultProps} />)
    act(() => {
      capturedOnOpenChange?.(true)
    })
    expect(screen.getByText('Tooltip content')).toBeInTheDocument()
  })

  it('should hide tooltip when onOpenChange triggers close', () => {
    render(<PreviewSlice {...defaultProps} />)
    act(() => {
      capturedOnOpenChange?.(true)
    })
    expect(screen.getByText('Tooltip content')).toBeInTheDocument()
    act(() => {
      capturedOnOpenChange?.(false)
    })
    expect(screen.queryByText('Tooltip content')).not.toBeInTheDocument()
  })

  it('should render ReactNode tooltip content when open', () => {
    render(<PreviewSlice {...defaultProps} tooltip={<strong>Rich tooltip</strong>} />)
    act(() => {
      capturedOnOpenChange?.(true)
    })
    expect(screen.getByText('Rich tooltip')).toBeInTheDocument()
  })

  it('should render ReactNode label', () => {
    render(<PreviewSlice {...defaultProps} label={<em>Emphasis</em>} />)
    expect(screen.getByText('Emphasis')).toBeInTheDocument()
  })
})
