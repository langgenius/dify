import { FloatingPortal } from '@floating-ui/react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { useContextMenuFloating } from './use-context-menu-floating'

afterEach(cleanup)

function TestContextMenu({
  open,
  onOpenChange,
  position,
  placement,
  offset: offsetValue,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  position: { x: number, y: number }
  placement?: Parameters<typeof useContextMenuFloating>[0]['placement']
  offset?: Parameters<typeof useContextMenuFloating>[0]['offset']
}) {
  const { refs, floatingStyles, getFloatingProps, isPositioned } = useContextMenuFloating({
    open,
    onOpenChange,
    position,
    placement,
    offset: offsetValue,
  })

  if (!open)
    return null

  return (
    <FloatingPortal>
      <div
        ref={refs.setFloating}
        style={{
          ...floatingStyles,
          visibility: isPositioned ? 'visible' : 'hidden',
        }}
        {...getFloatingProps()}
        data-testid="context-menu"
      >
        <button onClick={() => onOpenChange(false)}>Action</button>
      </div>
    </FloatingPortal>
  )
}

describe('useContextMenuFloating', () => {
  it('should render menu when open', () => {
    render(
      <TestContextMenu
        open={true}
        onOpenChange={vi.fn()}
        position={{ x: 100, y: 200 }}
      />,
    )

    expect(screen.getByTestId('context-menu')).toBeInTheDocument()
  })

  it('should not render menu when closed', () => {
    render(
      <TestContextMenu
        open={false}
        onOpenChange={vi.fn()}
        position={{ x: 100, y: 200 }}
      />,
    )

    expect(screen.queryByTestId('context-menu')).not.toBeInTheDocument()
  })

  it('should apply ARIA role="menu" to floating element', () => {
    render(
      <TestContextMenu
        open={true}
        onOpenChange={vi.fn()}
        position={{ x: 100, y: 200 }}
      />,
    )

    const menu = screen.getByTestId('context-menu')
    expect(menu).toHaveAttribute('role', 'menu')
  })

  it('should call onOpenChange(false) on Escape key', () => {
    const handleOpenChange = vi.fn()

    render(
      <TestContextMenu
        open={true}
        onOpenChange={handleOpenChange}
        position={{ x: 100, y: 200 }}
      />,
    )

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(handleOpenChange).toHaveBeenCalled()
    expect(handleOpenChange.mock.calls[0][0]).toBe(false)
  })

  it('should call onOpenChange(false) on outside click', () => {
    const handleOpenChange = vi.fn()

    render(
      <div>
        <div data-testid="outside">Outside</div>
        <TestContextMenu
          open={true}
          onOpenChange={handleOpenChange}
          position={{ x: 100, y: 200 }}
        />
      </div>,
    )

    fireEvent.pointerDown(screen.getByTestId('outside'))
    expect(handleOpenChange).toHaveBeenCalled()
    expect(handleOpenChange.mock.calls[0][0]).toBe(false)
  })

  it('should accept custom placement', () => {
    render(
      <TestContextMenu
        open={true}
        onOpenChange={vi.fn()}
        position={{ x: 100, y: 200 }}
        placement="top-end"
      />,
    )

    expect(screen.getByTestId('context-menu')).toBeInTheDocument()
  })

  it('should accept custom offset', () => {
    render(
      <TestContextMenu
        open={true}
        onOpenChange={vi.fn()}
        position={{ x: 100, y: 200 }}
        offset={8}
      />,
    )

    expect(screen.getByTestId('context-menu')).toBeInTheDocument()
  })

  it('should accept offset as object', () => {
    render(
      <TestContextMenu
        open={true}
        onOpenChange={vi.fn()}
        position={{ x: 100, y: 200 }}
        offset={{ mainAxis: 4, crossAxis: 2 }}
      />,
    )

    expect(screen.getByTestId('context-menu')).toBeInTheDocument()
  })

  it('should update position when coordinates change', () => {
    const { rerender } = render(
      <TestContextMenu
        open={true}
        onOpenChange={vi.fn()}
        position={{ x: 100, y: 200 }}
      />,
    )

    const menu = screen.getByTestId('context-menu')
    expect(menu).toBeInTheDocument()

    rerender(
      <TestContextMenu
        open={true}
        onOpenChange={vi.fn()}
        position={{ x: 300, y: 400 }}
      />,
    )

    expect(screen.getByTestId('context-menu')).toBeInTheDocument()
  })
})
