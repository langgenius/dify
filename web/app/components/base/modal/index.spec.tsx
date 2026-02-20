import { act, fireEvent, render, screen } from '@testing-library/react'
import Modal from '.'

describe('Modal', () => {
  describe('Render', () => {
    it('should not render content when isShow is false', () => {
      render(
        <Modal isShow={false} title="Test Modal">
          <div>Modal Content</div>
        </Modal>,
      )

      expect(screen.queryByText('Test Modal')).not.toBeInTheDocument()
      expect(screen.queryByText('Modal Content')).not.toBeInTheDocument()
    })

    it('should render content when isShow is true', async () => {
      await act(async () => {
        render(
          <Modal isShow={true} title="Test Modal">
            <div>Modal Content</div>
          </Modal>,
        )
      })

      expect(screen.getByText('Test Modal')).toBeInTheDocument()
      expect(screen.getByText('Modal Content')).toBeInTheDocument()
    })

    it('should render description when provided', async () => {
      await act(async () => {
        render(
          <Modal isShow={true} title="Test Modal" description="Test Description">
            <div>Content</div>
          </Modal>,
        )
      })

      expect(screen.getByText('Test Description')).toBeInTheDocument()
    })
  })

  describe('Interaction', () => {
    it('should call onClose when close button is clicked', async () => {
      const handleClose = vi.fn()
      await act(async () => {
        render(
          <Modal isShow={true} title="Test Modal" closable={true} onClose={handleClose}>
            <div>Content</div>
          </Modal>,
        )
      })

      const closeButton = screen.getByTestId('modal-close-button')
      expect(closeButton).toBeInTheDocument()
      await act(async () => {
        fireEvent.click(closeButton!)
      })
      expect(handleClose).toHaveBeenCalledTimes(1)
    })

    it('should prevent propagation when clicking the scrollable container', async () => {
      await act(async () => {
        render(
          <Modal isShow={true} title="Test Modal">
            <div>Content</div>
          </Modal>,
        )
      })

      const wrapper = document.querySelector('.overflow-y-auto')
      expect(wrapper).toBeInTheDocument()

      const event = new MouseEvent('click', { bubbles: true, cancelable: true })
      const stopPropagationSpy = vi.spyOn(event, 'stopPropagation')
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault')

      await act(async () => {
        wrapper!.dispatchEvent(event)
      })

      expect(stopPropagationSpy).toHaveBeenCalled()
      expect(preventDefaultSpy).toHaveBeenCalled()
    })

    it('should handle clickOutsideNotClose prop', async () => {
      const handleClose = vi.fn()
      await act(async () => {
        render(
          <Modal isShow={true} title="Test Modal" clickOutsideNotClose={true} onClose={handleClose}>
            <div>Content</div>
          </Modal>,
        )
      })

      await act(async () => {
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', code: 'Escape' })
      })

      expect(handleClose).not.toHaveBeenCalled()
    })
  })

  describe('Props', () => {
    it('should apply custom className to the panel', async () => {
      await act(async () => {
        render(
          <Modal isShow={true} title="Test Modal" className="custom-panel-class">
            <div>Content</div>
          </Modal>,
        )
      })

      const panel = screen.getByText('Test Modal').parentElement
      expect(panel).toHaveClass('custom-panel-class')
    })

    it('should apply wrapperClassName and containerClassName', async () => {
      await act(async () => {
        render(
          <Modal
            isShow={true}
            title="Test Modal"
            wrapperClassName="custom-wrapper"
            containerClassName="custom-container"
          >
            <div>Content</div>
          </Modal>,
        )
      })

      const dialog = document.querySelector('.custom-wrapper')
      expect(dialog).toBeInTheDocument()
      const container = document.querySelector('.custom-container')
      expect(container).toBeInTheDocument()
    })

    it('should apply highPriority z-index when highPriority is true', async () => {
      await act(async () => {
        render(
          <Modal isShow={true} title="Test Modal" highPriority={true}>
            <div>Content</div>
          </Modal>,
        )
      })

      const dialog = document.querySelector('.z-\\[1100\\]')
      expect(dialog).toBeInTheDocument()
    })

    it('should apply overlayOpacity background when overlayOpacity is true', async () => {
      await act(async () => {
        render(
          <Modal isShow={true} title="Test Modal" overlayOpacity={true}>
            <div>Content</div>
          </Modal>,
        )
      })

      const overlay = document.querySelector('.bg-workflow-canvas-canvas-overlay')
      expect(overlay).toBeInTheDocument()
    })

    it('should toggle overflow-visible class based on overflowVisible prop', async () => {
      const { rerender } = render(
        <Modal isShow={true} title="Test Modal" overflowVisible={true}>
          <div>Content</div>
        </Modal>,
      )

      let panel = screen.getByText('Test Modal').parentElement
      expect(panel).toHaveClass('overflow-visible')

      await act(async () => {
        rerender(
          <Modal isShow={true} title="Test Modal" overflowVisible={false}>
            <div>Content</div>
          </Modal>,
        )
      })
      panel = screen.getByText('Test Modal').parentElement
      expect(panel).toHaveClass('overflow-hidden')
    })
  })
})
