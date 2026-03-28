import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Drawer from '../drawer'

let capturedKeyPressCallback: ((e: KeyboardEvent) => void) | undefined

// Mock useKeyPress: required because tests capture the registered callback
// and invoke it directly to verify ESC key handling behavior.
vi.mock('ahooks', () => ({
  useKeyPress: vi.fn((_key: string, cb: (e: KeyboardEvent) => void) => {
    capturedKeyPressCallback = cb
  }),
}))

vi.mock('../..', () => ({
  useSegmentListContext: (selector: (state: {
    currSegment: { showModal: boolean }
    currChildChunk: { showModal: boolean }
  }) => unknown) =>
    selector({
      currSegment: { showModal: false },
      currChildChunk: { showModal: false },
    }),
}))

describe('Drawer', () => {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    capturedKeyPressCallback = undefined
  })

  describe('Rendering', () => {
    it('should return null when open is false', () => {
      const { container } = render(
        <Drawer open={false} onClose={vi.fn()}>
          <span>Content</span>
        </Drawer>,
      )

      expect(container.innerHTML).toBe('')
      expect(screen.queryByText('Content')).not.toBeInTheDocument()
    })

    it('should render children in portal when open is true', () => {
      render(
        <Drawer {...defaultProps}>
          <span>Drawer content</span>
        </Drawer>,
      )

      expect(screen.getByText('Drawer content')).toBeInTheDocument()
    })

    it('should render dialog with role="dialog"', () => {
      render(
        <Drawer {...defaultProps}>
          <span>Content</span>
        </Drawer>,
      )

      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
  })

  // Overlay visibility
  describe('Overlay', () => {
    it('should show overlay when showOverlay is true', () => {
      render(
        <Drawer {...defaultProps} showOverlay={true}>
          <span>Content</span>
        </Drawer>,
      )

      const overlay = document.querySelector('[aria-hidden="true"]')
      expect(overlay).toBeInTheDocument()
    })

    it('should hide overlay when showOverlay is false', () => {
      render(
        <Drawer {...defaultProps} showOverlay={false}>
          <span>Content</span>
        </Drawer>,
      )

      const overlay = document.querySelector('[aria-hidden="true"]')
      expect(overlay).not.toBeInTheDocument()
    })
  })

  // aria-modal attribute
  describe('aria-modal', () => {
    it('should set aria-modal="true" when modal is true', () => {
      render(
        <Drawer {...defaultProps} modal={true}>
          <span>Content</span>
        </Drawer>,
      )

      expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
    })

    it('should set aria-modal="false" when modal is false', () => {
      render(
        <Drawer {...defaultProps} modal={false}>
          <span>Content</span>
        </Drawer>,
      )

      expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'false')
    })
  })

  // ESC key handling
  describe('ESC Key', () => {
    it('should call onClose when ESC is pressed and drawer is open', () => {
      const onClose = vi.fn()
      render(
        <Drawer open={true} onClose={onClose}>
          <span>Content</span>
        </Drawer>,
      )

      expect(capturedKeyPressCallback).toBeDefined()
      const fakeEvent = { preventDefault: vi.fn() } as unknown as KeyboardEvent
      capturedKeyPressCallback!(fakeEvent)

      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })
})
