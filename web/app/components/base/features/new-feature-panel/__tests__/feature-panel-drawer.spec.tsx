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

  describe('Props', () => {
    it('should apply workflow styles by default', () => {
      render(
        <FeaturePanelDrawer show>
          <div data-testid="content">Content</div>
        </FeaturePanelDrawer>,
      )

      const drawer = screen.getByRole('dialog')
      expect(drawer).toHaveClass('data-[swipe-direction=right]:!top-[112px]')
      expect(drawer).toHaveClass('data-[swipe-direction=right]:!rounded-l-2xl')
      expect(drawer).not.toHaveClass('data-[swipe-direction=right]:!rounded-2xl')
    })

    it('should apply non-workflow styles when inWorkflow is false', () => {
      render(
        <FeaturePanelDrawer show inWorkflow={false}>
          <div data-testid="content">Content</div>
        </FeaturePanelDrawer>,
      )

      const drawer = screen.getByRole('dialog')
      const layoutContainer = screen.getByTestId('feature-panel-drawer-layout')

      expect(layoutContainer).toBeInTheDocument()

      expect(drawer).toHaveClass('data-[swipe-direction=right]:!top-[64px]')
      expect(drawer).toHaveClass('data-[swipe-direction=right]:!right-2')
      expect(drawer).toHaveClass('data-[swipe-direction=right]:!rounded-2xl')
      expect(drawer).toHaveClass('data-[swipe-direction=right]:!border-[0.5px]')
      expect(drawer).not.toHaveClass('data-[swipe-direction=right]:!rounded-l-2xl')
    })

    it('should accept custom className', () => {
      render(
        <FeaturePanelDrawer show className="custom-class">
          <div data-testid="content">Content</div>
        </FeaturePanelDrawer>,
      )

      expect(screen.getByRole('dialog')).toHaveClass('custom-class')
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
