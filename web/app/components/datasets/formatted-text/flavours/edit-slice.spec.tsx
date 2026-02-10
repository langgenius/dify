import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EditSlice } from './edit-slice'

vi.mock('@floating-ui/react', () => ({
  autoUpdate: vi.fn(),
  flip: vi.fn(),
  shift: vi.fn(),
  offset: vi.fn(),
  FloatingFocusManager: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useFloating: () => ({
    refs: { setReference: vi.fn(), setFloating: vi.fn() },
    floatingStyles: {},
    context: { open: false, onOpenChange: vi.fn(), refs: { domReference: { current: null } }, nodeId: undefined },
  }),
  useHover: () => ({}),
  useDismiss: () => ({}),
  useRole: () => ({}),
  useInteractions: () => ({
    getReferenceProps: () => ({}),
    getFloatingProps: () => ({}),
  }),
}))

vi.mock('@remixicon/react', () => ({
  RiDeleteBinLine: () => <span data-testid="delete-icon" />,
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

describe('EditSlice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render label and text', () => {
    render(<EditSlice label="C-1" text="chunk content" onDelete={vi.fn()} />)
    expect(screen.getByText('C-1')).toBeInTheDocument()
    expect(screen.getByText('chunk content')).toBeInTheDocument()
  })

  it('should render divider by default', () => {
    const { container } = render(<EditSlice label="C-1" text="text" onDelete={vi.fn()} />)
    // SliceDivider renders a zero-width space
    const spans = container.querySelectorAll('span')
    const dividerSpan = Array.from(spans).find(s => s.textContent?.includes('\u200B'))
    expect(dividerSpan).toBeTruthy()
  })

  it('should not render divider when showDivider is false', () => {
    const { container } = render(
      <EditSlice label="C-1" text="text" onDelete={vi.fn()} showDivider={false} />,
    )
    const spans = container.querySelectorAll('span')
    const dividerSpan = Array.from(spans).find(s => s.textContent === '\u200B')
    expect(dividerSpan).toBeFalsy()
  })

  it('should apply custom labelClassName', () => {
    render(<EditSlice label="C-1" text="text" onDelete={vi.fn()} labelClassName="custom-label" />)
    const labelParent = screen.getByText('C-1').parentElement!
    expect(labelParent).toHaveClass('custom-label')
  })

  it('should apply custom contentClassName', () => {
    render(<EditSlice label="C-1" text="content" onDelete={vi.fn()} contentClassName="custom-content" />)
    expect(screen.getByText('content')).toHaveClass('custom-content')
  })
})
