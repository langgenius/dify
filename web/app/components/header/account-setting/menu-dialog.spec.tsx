import { fireEvent, render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import MenuDialog from './menu-dialog'

describe('MenuDialog', () => {
  it('renders children when show is true', () => {
    render(
      <MenuDialog show={true} onClose={vi.fn()}>
        <div data-testid="dialog-content">Content</div>
      </MenuDialog>,
    )
    expect(screen.getByTestId('dialog-content')).toBeInTheDocument()
  })

  it('calls onClose when Escape key is pressed', () => {
    const onClose = vi.fn()
    render(
      <MenuDialog show={true} onClose={onClose}>
        <div>Content</div>
      </MenuDialog>,
    )

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('does not render children when show is false', () => {
    render(
      <MenuDialog show={false} onClose={vi.fn()}>
        <div data-testid="dialog-content">Content</div>
      </MenuDialog>,
    )
    expect(screen.queryByTestId('dialog-content')).not.toBeInTheDocument()
  })
})
