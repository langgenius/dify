import { act, fireEvent, render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import MenuDialog from './menu-dialog'

describe('MenuDialog', () => {
  it('renders children when show is true', async () => {
    await act(async () => {
      render(
        <MenuDialog show={true} onClose={vi.fn()}>
          <div data-testid="dialog-content">Content</div>
        </MenuDialog>,
      )
    })
    expect(screen.getByTestId('dialog-content')).toBeInTheDocument()
  })

  it('calls onClose when Escape key is pressed', async () => {
    const onClose = vi.fn()
    await act(async () => {
      render(
        <MenuDialog show={true} onClose={onClose}>
          <div>Content</div>
        </MenuDialog>,
      )
    })

    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })
    expect(onClose).toHaveBeenCalled()
  })

  it('does not call onClose when a key other than Escape is pressed', async () => {
    const onClose = vi.fn()
    await act(async () => {
      render(
        <MenuDialog show={true} onClose={onClose}>
          <div>Content</div>
        </MenuDialog>,
      )
    })

    await act(async () => {
      fireEvent.keyDown(document, { key: 'Enter' })
    })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('does not crash when Escape is pressed and onClose is not provided', async () => {
    await act(async () => {
      render(
        <MenuDialog show={true}>
          <div data-testid="dialog-content">Content</div>
        </MenuDialog>,
      )
    })

    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })
    expect(screen.getByTestId('dialog-content')).toBeInTheDocument()
  })

  it('applies custom className', async () => {
    await act(async () => {
      render(
        <MenuDialog show={true} onClose={vi.fn()} className="custom-class">
          <div data-testid="dialog-content">Content</div>
        </MenuDialog>,
      )
    })
    const panel = screen.getByRole('dialog').querySelector('.custom-class')
    expect(panel).toBeInTheDocument()
  })

  it('does not render children when show is false', async () => {
    await act(async () => {
      render(
        <MenuDialog show={false} onClose={vi.fn()}>
          <div data-testid="dialog-content">Content</div>
        </MenuDialog>,
      )
    })
    expect(screen.queryByTestId('dialog-content')).not.toBeInTheDocument()
  })
})
