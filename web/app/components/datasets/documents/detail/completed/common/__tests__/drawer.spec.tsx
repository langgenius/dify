import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CompletedDrawer } from '../drawer'

(
  globalThis as typeof globalThis & {
    BASE_UI_ANIMATIONS_DISABLED: boolean
  }
).BASE_UI_ANIMATIONS_DISABLED = true

const getOverlay = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[class]'))
    .find(element => element.className.includes('bg-background-overlay'))

describe('Drawer', () => {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should return null when open is false', () => {
      const { container } = render(
        <CompletedDrawer open={false} onClose={vi.fn()}>
          <span>Content</span>
        </CompletedDrawer>,
      )

      expect(container.innerHTML).toBe('')
      expect(screen.queryByText('Content')).not.toBeInTheDocument()
    })

    it('should render children in the drawer portal when open is true', () => {
      render(
        <CompletedDrawer {...defaultProps}>
          <span>Drawer content</span>
        </CompletedDrawer>,
      )

      expect(screen.getByText('Drawer content')).toBeInTheDocument()
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
  })

  describe('Variant', () => {
    it('should render a panel drawer without overlay by default', () => {
      render(
        <CompletedDrawer {...defaultProps}>
          <span>Content</span>
        </CompletedDrawer>,
      )

      expect(getOverlay()).toBeUndefined()
      expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'false')
    })

    it('should render a modal drawer with overlay', () => {
      render(
        <CompletedDrawer {...defaultProps} modal>
          <span>Content</span>
        </CompletedDrawer>,
      )

      expect(getOverlay()).toBeInTheDocument()
      expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
    })
  })

  describe('Dismissal', () => {
    it('should call onClose when Escape is pressed', async () => {
      const onClose = vi.fn()
      render(
        <CompletedDrawer open={true} onClose={onClose}>
          <span>Content</span>
        </CompletedDrawer>,
      )

      fireEvent.keyDown(document, { key: 'Escape' })

      await waitFor(() => {
        expect(onClose).toHaveBeenCalledTimes(1)
      })
    })

    it('should keep a panel drawer open when the underlying page is clicked', () => {
      const onClose = vi.fn()
      render(
        <>
          <button type="button">Outside</button>
          <CompletedDrawer open={true} onClose={onClose}>
            <span>Content</span>
          </CompletedDrawer>
        </>,
      )

      fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }))

      expect(onClose).not.toHaveBeenCalled()
    })

    it('should keep a panel drawer open when the pointer down starts inside content', () => {
      const onClose = vi.fn()
      render(
        <CompletedDrawer open={true} onClose={onClose}>
          <button type="button">Inside</button>
        </CompletedDrawer>,
      )

      fireEvent.pointerDown(screen.getByRole('button', { name: 'Inside' }))

      expect(onClose).not.toHaveBeenCalled()
    })
    it('should close a modal drawer when the overlay is clicked', () => {
      const onClose = vi.fn()
      render(
        <CompletedDrawer open={true} onClose={onClose} modal>
          <span>Content</span>
        </CompletedDrawer>,
      )

      fireEvent.click(getOverlay()!)

      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })
})
