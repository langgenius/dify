import type { ReactNode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SliceContainer, SliceContent, SliceDivider, SliceLabel } from './flavours/shared'
import { FormattedText } from './formatted'

// Capture onOpenChange so tests can trigger open/close via React state
let capturedOnOpenChange: ((open: boolean) => void) | null = null

vi.mock('@floating-ui/react', () => {
  return {
    autoUpdate: vi.fn(),
    flip: vi.fn(() => 'flip-middleware'),
    shift: vi.fn(() => 'shift-middleware'),
    offset: vi.fn(() => 'offset-middleware'),
    inline: vi.fn(() => 'inline-middleware'),
    useFloating: vi.fn(({ open, onOpenChange }: { open: boolean, onOpenChange: (v: boolean) => void }) => {
      capturedOnOpenChange = onOpenChange
      return {
        refs: {
          setReference: vi.fn(),
          setFloating: vi.fn(),
        },
        floatingStyles: { position: 'absolute' as const, top: 0, left: 0 },
        context: { open, onOpenChange },
      }
    }),
    useHover: vi.fn(() => ({})),
    useDismiss: vi.fn(() => ({})),
    useRole: vi.fn(() => ({})),
    useInteractions: vi.fn(() => ({
      getReferenceProps: vi.fn(() => ({})),
      getFloatingProps: vi.fn(() => ({})),
    })),
    FloatingFocusManager: ({ children }: { children: ReactNode }) => (
      <div data-testid="floating-focus-manager">{children}</div>
    ),
  }
})

// Lazy import after mocks are set up
const { EditSlice } = await import('./flavours/edit-slice')
const { PreviewSlice } = await import('./flavours/preview-slice')

/** Helper: find the leaf span that contains the zero-width space (SliceDivider) */
const findDividerSpan = (container: HTMLElement): HTMLSpanElement | undefined => {
  const spans = container.querySelectorAll('span')
  return Array.from(spans).find(
    s => s.children.length === 0 && s.textContent?.includes('\u200B'),
  )
}

afterEach(() => {
  cleanup()
})

// Tests for FormattedText - a paragraph wrapper with default leading-7 class
describe('FormattedText', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render children when provided', () => {
    render(<FormattedText>Hello World</FormattedText>)

    expect(screen.getByText('Hello World')).toBeInTheDocument()
  })

  it('should render as a p element', () => {
    render(<FormattedText>content</FormattedText>)

    expect(screen.getByText('content').tagName).toBe('P')
  })

  it('should apply default leading-7 class', () => {
    render(<FormattedText>text</FormattedText>)

    expect(screen.getByText('text')).toHaveClass('leading-7')
  })

  it('should merge custom className with default class', () => {
    render(<FormattedText className="custom-class">text</FormattedText>)

    const el = screen.getByText('text')
    expect(el).toHaveClass('leading-7')
    expect(el).toHaveClass('custom-class')
  })

  it('should pass rest props to the p element', () => {
    render(<FormattedText data-testid="formatted" id="my-id">text</FormattedText>)

    const el = screen.getByTestId('formatted')
    expect(el).toHaveAttribute('id', 'my-id')
  })

  it('should render nested elements as children', () => {
    render(
      <FormattedText>
        <span>nested</span>
      </FormattedText>,
    )

    expect(screen.getByText('nested')).toBeInTheDocument()
  })

  it('should render with empty children without crashing', () => {
    const { container } = render(<FormattedText />)

    expect(container.querySelector('p')).toBeInTheDocument()
  })
})

// Tests for shared slice wrapper components
describe('SliceContainer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render as a span element', () => {
    render(<SliceContainer data-testid="container" />)

    expect(screen.getByTestId('container').tagName).toBe('SPAN')
  })

  it('should apply default className', () => {
    render(<SliceContainer data-testid="container" />)

    expect(screen.getByTestId('container')).toHaveClass('group', 'mr-1', 'select-none', 'align-bottom', 'text-sm')
  })

  it('should merge custom className', () => {
    render(<SliceContainer data-testid="container" className="extra" />)

    const el = screen.getByTestId('container')
    expect(el).toHaveClass('group')
    expect(el).toHaveClass('extra')
  })

  it('should pass rest props to span', () => {
    render(<SliceContainer data-testid="container" id="slice-1" />)

    expect(screen.getByTestId('container')).toHaveAttribute('id', 'slice-1')
  })

  it('should have correct displayName', () => {
    expect(SliceContainer.displayName).toBe('SliceContainer')
  })
})

describe('SliceLabel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render children', () => {
    render(<SliceLabel>Label Text</SliceLabel>)

    expect(screen.getByText('Label Text')).toBeInTheDocument()
  })

  it('should apply default classes including uppercase and bg classes', () => {
    render(<SliceLabel data-testid="label">L</SliceLabel>)

    const outer = screen.getByTestId('label')
    expect(outer).toHaveClass('uppercase')
    expect(outer).toHaveClass('px-1')
  })

  it('should merge custom className', () => {
    render(<SliceLabel data-testid="label" className="custom">L</SliceLabel>)

    expect(screen.getByTestId('label')).toHaveClass('custom')
  })

  it('should apply labelInnerClassName to inner span', () => {
    render(<SliceLabel labelInnerClassName="inner-custom">L</SliceLabel>)

    const inner = screen.getByText('L')
    expect(inner).toHaveClass('text-nowrap')
    expect(inner).toHaveClass('inner-custom')
  })

  it('should have correct displayName', () => {
    expect(SliceLabel.displayName).toBe('SliceLabel')
  })

  it('should pass rest props', () => {
    render(<SliceLabel data-testid="label" aria-label="chunk label">L</SliceLabel>)

    expect(screen.getByTestId('label')).toHaveAttribute('aria-label', 'chunk label')
  })
})

describe('SliceContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render children', () => {
    render(<SliceContent>Some content</SliceContent>)

    expect(screen.getByText('Some content')).toBeInTheDocument()
  })

  it('should apply default classes', () => {
    render(<SliceContent data-testid="content">text</SliceContent>)

    const el = screen.getByTestId('content')
    expect(el).toHaveClass('whitespace-pre-line', 'break-all', 'px-1', 'leading-7')
  })

  it('should merge custom className', () => {
    render(<SliceContent data-testid="content" className="my-class">text</SliceContent>)

    expect(screen.getByTestId('content')).toHaveClass('my-class')
  })

  it('should have correct displayName', () => {
    expect(SliceContent.displayName).toBe('SliceContent')
  })

  it('should pass rest props', () => {
    render(<SliceContent data-testid="content" title="hover">text</SliceContent>)

    expect(screen.getByTestId('content')).toHaveAttribute('title', 'hover')
  })
})

describe('SliceDivider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render a span element', () => {
    render(<SliceDivider data-testid="divider" />)

    expect(screen.getByTestId('divider').tagName).toBe('SPAN')
  })

  it('should contain a zero-width space character', () => {
    render(<SliceDivider data-testid="divider" />)

    expect(screen.getByTestId('divider').textContent).toContain('\u200B')
  })

  it('should apply default classes', () => {
    render(<SliceDivider data-testid="divider" />)

    expect(screen.getByTestId('divider')).toHaveClass('px-[1px]', 'text-sm')
  })

  it('should merge custom className', () => {
    render(<SliceDivider data-testid="divider" className="extra" />)

    expect(screen.getByTestId('divider')).toHaveClass('extra')
  })

  it('should have correct displayName', () => {
    expect(SliceDivider.displayName).toBe('SliceDivider')
  })

  it('should pass rest props', () => {
    render(<SliceDivider data-testid="divider" id="d1" />)

    expect(screen.getByTestId('divider')).toHaveAttribute('id', 'd1')
  })
})

// Tests for EditSlice - floating delete button on hover
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

  it('should render label and text', () => {
    render(<EditSlice {...defaultProps} />)

    expect(screen.getByText('S1')).toBeInTheDocument()
    expect(screen.getByText('Sample text content')).toBeInTheDocument()
  })

  it('should render divider by default when showDivider is true', () => {
    const { container } = render(<EditSlice {...defaultProps} />)

    expect(findDividerSpan(container)).toBeTruthy()
  })

  it('should hide divider when showDivider is false', () => {
    const { container } = render(<EditSlice {...defaultProps} showDivider={false} />)

    expect(findDividerSpan(container)).toBeUndefined()
  })

  it('should not show delete button when floating is closed', () => {
    render(<EditSlice {...defaultProps} />)

    expect(screen.queryByTestId('floating-focus-manager')).not.toBeInTheDocument()
  })

  it('should show delete button when onOpenChange triggers open', () => {
    render(<EditSlice {...defaultProps} />)

    // Simulate floating-ui hover triggering open via the captured state setter
    act(() => {
      capturedOnOpenChange?.(true)
    })

    expect(screen.getByTestId('floating-focus-manager')).toBeInTheDocument()
  })

  it('should call onDelete when delete button is clicked', () => {
    const onDelete = vi.fn()
    render(<EditSlice {...defaultProps} onDelete={onDelete} />)

    // Open the floating UI
    act(() => {
      capturedOnOpenChange?.(true)
    })

    const deleteBtn = screen.getByRole('button')
    fireEvent.click(deleteBtn)

    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('should close floating after delete button is clicked', () => {
    render(<EditSlice {...defaultProps} />)

    act(() => {
      capturedOnOpenChange?.(true)
    })
    expect(screen.getByTestId('floating-focus-manager')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button'))

    // setDelBtnShow(false) is called after onDelete
    expect(screen.queryByTestId('floating-focus-manager')).not.toBeInTheDocument()
  })

  it('should apply custom className to SliceContainer', () => {
    render(<EditSlice {...defaultProps} data-testid="edit-slice" className="custom-slice" />)

    expect(screen.getByTestId('edit-slice')).toHaveClass('custom-slice')
  })

  it('should apply labelClassName to SliceLabel', () => {
    render(<EditSlice {...defaultProps} labelClassName="label-extra" />)

    const labelEl = screen.getByText('S1').parentElement
    expect(labelEl).toHaveClass('label-extra')
  })

  it('should apply contentClassName to SliceContent', () => {
    render(<EditSlice {...defaultProps} contentClassName="content-extra" />)

    expect(screen.getByText('Sample text content')).toHaveClass('content-extra')
  })

  it('should apply labelInnerClassName to SliceLabel inner span', () => {
    render(<EditSlice {...defaultProps} labelInnerClassName="inner-label" />)

    expect(screen.getByText('S1')).toHaveClass('inner-label')
  })

  it('should apply destructive styles when hovering on delete button container', async () => {
    render(<EditSlice {...defaultProps} />)

    // Open floating
    act(() => {
      capturedOnOpenChange?.(true)
    })

    // Hover on the floating span to trigger destructive style
    const floatingSpan = screen.getByTestId('floating-focus-manager').firstElementChild as HTMLElement
    fireEvent.mouseEnter(floatingSpan)

    await waitFor(() => {
      const labelEl = screen.getByText('S1').parentElement
      expect(labelEl).toHaveClass('!bg-state-destructive-solid')
      expect(labelEl).toHaveClass('!text-text-primary-on-surface')
    })

    // Content should also get destructive style
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

  it('should apply destructive style to divider when hovering delete button', async () => {
    const { container } = render(<EditSlice {...defaultProps} />)

    act(() => {
      capturedOnOpenChange?.(true)
    })

    const floatingSpan = screen.getByTestId('floating-focus-manager').firstElementChild as HTMLElement
    fireEvent.mouseEnter(floatingSpan)

    await waitFor(() => {
      const divider = findDividerSpan(container)
      expect(divider).toHaveClass('!bg-state-destructive-hover-alt')
    })
  })

  it('should pass rest props to SliceContainer', () => {
    render(<EditSlice {...defaultProps} data-testid="edit-slice" />)

    expect(screen.getByTestId('edit-slice')).toBeInTheDocument()
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
})

// Tests for PreviewSlice - tooltip on hover
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

  it('should render label and text', () => {
    render(<PreviewSlice {...defaultProps} />)

    expect(screen.getByText('P1')).toBeInTheDocument()
    expect(screen.getByText('Preview text')).toBeInTheDocument()
  })

  it('should not show tooltip by default', () => {
    render(<PreviewSlice {...defaultProps} />)

    expect(screen.queryByText('Tooltip content')).not.toBeInTheDocument()
  })

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

  it('should always render a divider', () => {
    const { container } = render(<PreviewSlice {...defaultProps} />)

    expect(findDividerSpan(container)).toBeTruthy()
  })

  it('should apply custom className to SliceContainer', () => {
    render(<PreviewSlice {...defaultProps} data-testid="preview-slice" className="preview-custom" />)

    expect(screen.getByTestId('preview-slice')).toHaveClass('preview-custom')
  })

  it('should apply labelInnerClassName to the label inner span', () => {
    render(<PreviewSlice {...defaultProps} labelInnerClassName="label-inner" />)

    expect(screen.getByText('P1')).toHaveClass('label-inner')
  })

  it('should apply dividerClassName to SliceDivider', () => {
    const { container } = render(<PreviewSlice {...defaultProps} dividerClassName="divider-custom" />)

    const divider = findDividerSpan(container)
    expect(divider).toHaveClass('divider-custom')
  })

  it('should pass rest props to SliceContainer', () => {
    render(<PreviewSlice {...defaultProps} data-testid="preview-slice" />)

    expect(screen.getByTestId('preview-slice')).toBeInTheDocument()
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
