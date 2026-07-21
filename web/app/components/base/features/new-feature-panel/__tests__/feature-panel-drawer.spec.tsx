import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { FeaturePanelDrawer } from '../feature-panel-drawer'

describe('FeaturePanelDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render children when show is true', () => {
      render(
        <FeaturePanelDrawer show>
          <div data-testid="content">Content</div>
        </FeaturePanelDrawer>,
      )

      expect(screen.getByTestId('content')).toBeInTheDocument()
    })

    it('should not render children when show is false', () => {
      render(
        <FeaturePanelDrawer show={false}>
          <div data-testid="content">Content</div>
        </FeaturePanelDrawer>,
      )

      expect(screen.queryByTestId('content')).not.toBeInTheDocument()
    })
  })

  describe('Close behavior', () => {
    it('should call onClose when escape is pressed', async () => {
      const onClose = vi.fn()

      render(
        <FeaturePanelDrawer show onClose={onClose}>
          <div>Content</div>
        </FeaturePanelDrawer>,
      )

      fireEvent.keyDown(document, { key: 'Escape' })

      await waitFor(() => {
        expect(onClose).toHaveBeenCalledTimes(1)
      })
    })

    it('should not throw when escape is pressed without onClose', () => {
      render(
        <FeaturePanelDrawer show>
          <div>Content</div>
        </FeaturePanelDrawer>,
      )

      expect(() => {
        fireEvent.keyDown(document, { key: 'Escape' })
      }).not.toThrow()
    })
  })
})
