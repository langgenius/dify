import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CompletedDrawer } from '../drawer'

(
  globalThis as typeof globalThis & {
    BASE_UI_ANIMATIONS_DISABLED: boolean
  }
).BASE_UI_ANIMATIONS_DISABLED = true

let segmentModalOpen = false
let childChunkModalOpen = false

vi.mock('../..', () => ({
  useSegmentListContext: (selector: (state: {
    currSegment: { showModal: boolean }
    currChildChunk: { showModal: boolean }
  }) => unknown) =>
    selector({
      currSegment: { showModal: segmentModalOpen },
      currChildChunk: { showModal: childChunkModalOpen },
    }),
}))

const getOverlay = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[class]'))
    .find(element => element.className.includes('bg-black/30'))

describe('Drawer', () => {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    segmentModalOpen = false
    childChunkModalOpen = false
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

  describe('Overlay', () => {
    it('should show overlay when showOverlay is true', () => {
      render(
        <CompletedDrawer {...defaultProps} showOverlay={true}>
          <span>Content</span>
        </CompletedDrawer>,
      )

      expect(getOverlay()).toBeInTheDocument()
    })

    it('should hide overlay when showOverlay is false', () => {
      render(
        <CompletedDrawer {...defaultProps} showOverlay={false}>
          <span>Content</span>
        </CompletedDrawer>,
      )

      expect(getOverlay()).toBeUndefined()
    })
  })

  describe('Modality', () => {
    it('should set aria-modal="true" when modal is true', () => {
      render(
        <CompletedDrawer {...defaultProps} modal={true}>
          <span>Content</span>
        </CompletedDrawer>,
      )

      expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
    })

    it('should set aria-modal="false" when modal is false', () => {
      render(
        <CompletedDrawer {...defaultProps} modal={false}>
          <span>Content</span>
        </CompletedDrawer>,
      )

      expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'false')
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

    it('should call onClose when a non-modal drawer receives an outside pointer down', async () => {
      const onClose = vi.fn()
      render(
        <>
          <button type="button">Outside</button>
          <CompletedDrawer open={true} onClose={onClose} modal={false}>
            <span>Content</span>
          </CompletedDrawer>
        </>,
      )

      fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }))

      await waitFor(() => {
        expect(onClose).toHaveBeenCalledTimes(1)
      })
    })

    it('should keep a non-modal drawer open when the pointer down starts inside content', () => {
      const onClose = vi.fn()
      render(
        <CompletedDrawer open={true} onClose={onClose} modal={false}>
          <button type="button">Inside</button>
        </CompletedDrawer>,
      )

      fireEvent.pointerDown(screen.getByRole('button', { name: 'Inside' }))

      expect(onClose).not.toHaveBeenCalled()
    })

    it('should keep a non-modal drawer open when an image preview is clicked', () => {
      const onClose = vi.fn()
      render(
        <>
          <div className="image-previewer">
            <button type="button">Preview</button>
          </div>
          <CompletedDrawer open={true} onClose={onClose} modal={false}>
            <span>Content</span>
          </CompletedDrawer>
        </>,
      )

      fireEvent.pointerDown(screen.getByRole('button', { name: 'Preview' }))

      expect(onClose).not.toHaveBeenCalled()
    })

    it('should preserve chunk switching rules when checking outside clicks', async () => {
      const onClose = vi.fn()
      segmentModalOpen = true
      render(
        <>
          <button type="button" className="child-chunk">Child chunk</button>
          <CompletedDrawer open={true} onClose={onClose} modal={false} needCheckChunks>
            <span>Content</span>
          </CompletedDrawer>
        </>,
      )

      fireEvent.pointerDown(screen.getByRole('button', { name: 'Child chunk' }))

      await waitFor(() => {
        expect(onClose).toHaveBeenCalledTimes(1)
      })
    })

    it('should close a modal drawer when the overlay is clicked', () => {
      const onClose = vi.fn()
      render(
        <CompletedDrawer open={true} onClose={onClose} modal={true}>
          <span>Content</span>
        </CompletedDrawer>,
      )

      fireEvent.click(getOverlay()!)

      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })
})
