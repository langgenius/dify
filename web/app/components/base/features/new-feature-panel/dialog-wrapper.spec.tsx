import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import DialogWrapper from './dialog-wrapper'

describe('DialogWrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render children when show is true', () => {
      render(
        <DialogWrapper show>
          <div data-testid="content">Content</div>
        </DialogWrapper>,
      )

      expect(screen.getByTestId('content')).toBeInTheDocument()
    })

    it('should not render children when show is false', () => {
      render(
        <DialogWrapper show={false}>
          <div data-testid="content">Content</div>
        </DialogWrapper>,
      )

      expect(screen.queryByTestId('content')).not.toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should apply workflow styles by default', () => {
      render(
        <DialogWrapper show>
          <div data-testid="content">Content</div>
        </DialogWrapper>,
      )

      const wrapper = screen.getByTestId('content').parentElement
      expect(wrapper).toHaveClass('rounded-l-2xl')
      expect(wrapper).not.toHaveClass('rounded-2xl')
    })

    it('should apply non-workflow styles when inWorkflow is false', () => {
      render(
        <DialogWrapper show inWorkflow={false}>
          <div data-testid="content">Content</div>
        </DialogWrapper>,
      )

      const content = screen.getByTestId('content')
      const panel = content.parentElement
      const layoutContainer = screen.getByTestId('dialog-layout-container')

      expect(layoutContainer).toHaveClass('pr-2')
      expect(layoutContainer).toHaveClass('pt-[64px]')
      expect(layoutContainer).not.toHaveClass('pt-[112px]')

      expect(panel).toHaveClass('rounded-2xl')
      expect(panel).toHaveClass('border-[0.5px]')
      expect(panel).not.toHaveClass('rounded-l-2xl')
    })

    it('should accept custom className', () => {
      render(
        <DialogWrapper show className="custom-class">
          <div data-testid="content">Content</div>
        </DialogWrapper>,
      )

      const wrapper = screen.getByTestId('content').parentElement
      expect(wrapper).toHaveClass('custom-class')
    })
  })

  describe('Close behavior', () => {
    it('should call onClose when escape is pressed', async () => {
      const onClose = vi.fn()

      render(
        <DialogWrapper show onClose={onClose}>
          <div>Content</div>
        </DialogWrapper>,
      )

      fireEvent.keyDown(document, { key: 'Escape' })

      await waitFor(() => {
        expect(onClose).toHaveBeenCalledTimes(1)
      })
    })

    it('should not throw when escape is pressed without onClose', () => {
      render(
        <DialogWrapper show>
          <div>Content</div>
        </DialogWrapper>,
      )

      expect(() => {
        fireEvent.keyDown(document, { key: 'Escape' })
      }).not.toThrow()
    })
  })
})
