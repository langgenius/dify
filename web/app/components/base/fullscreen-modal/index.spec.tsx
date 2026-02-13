import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import FullScreenModal from './index'

describe('FullScreenModal Component', () => {
  it('should not render anything when open is false', () => {
    render(
      <FullScreenModal open={false}>
        <div data-testid="modal-content">Content</div>
      </FullScreenModal>,
    )
    expect(screen.queryByTestId('modal-content')).not.toBeInTheDocument()
  })

  it('should render content when open is true', async () => {
    render(
      <FullScreenModal open={true}>
        <div data-testid="modal-content">Content</div>
      </FullScreenModal>,
    )
    expect(await screen.findByTestId('modal-content')).toBeInTheDocument()
  })

  it('should not crash when provided with title and description props', async () => {
    await act(async () => {
      render(
        <FullScreenModal
          open={true}
          title="My Title"
          description="My Description"
        >
          Content
        </FullScreenModal>,
      )
    })
  })

  describe('Props Handling', () => {
    it('should apply wrapperClassName to the dialog root', async () => {
      render(
        <FullScreenModal
          open={true}
          wrapperClassName="custom-wrapper-class"
        >
          Content
        </FullScreenModal>,
      )

      await screen.findByRole('dialog')
      const element = document.querySelector('.custom-wrapper-class')
      expect(element).toBeInTheDocument()
      expect(element).toHaveClass('modal-dialog')
    })

    it('should apply className to the inner panel', async () => {
      await act(async () => {
        render(
          <FullScreenModal
            open={true}
            className="custom-panel-class"
          >
            Content
          </FullScreenModal>,
        )
      })
      const panel = document.querySelector('.custom-panel-class')
      expect(panel).toBeInTheDocument()
      expect(panel).toHaveClass('h-full')
    })

    it('should handle overflowVisible prop', async () => {
      const { rerender } = await act(async () => {
        return render(
          <FullScreenModal
            open={true}
            overflowVisible={true}
            className="target-panel"
          >
            Content
          </FullScreenModal>,
        )
      })
      let panel = document.querySelector('.target-panel')
      expect(panel).toHaveClass('overflow-visible')
      expect(panel).not.toHaveClass('overflow-hidden')

      await act(async () => {
        rerender(
          <FullScreenModal
            open={true}
            overflowVisible={false}
            className="target-panel"
          >
            Content
          </FullScreenModal>,
        )
      })
      panel = document.querySelector('.target-panel')
      expect(panel).toHaveClass('overflow-hidden')
      expect(panel).not.toHaveClass('overflow-visible')
    })

    it('should render close button when closable is true', async () => {
      await act(async () => {
        render(
          <FullScreenModal open={true} closable={true}>
            Content
          </FullScreenModal>,
        )
      })
      const closeButton = document.querySelector('.bg-components-button-tertiary-bg')
      expect(closeButton).toBeInTheDocument()
    })

    it('should not render close button when closable is false', async () => {
      await act(async () => {
        render(
          <FullScreenModal open={true} closable={false}>
            Content
          </FullScreenModal>,
        )
      })
      const closeButton = document.querySelector('.bg-components-button-tertiary-bg')
      expect(closeButton).not.toBeInTheDocument()
    })
  })

  describe('Interactions', () => {
    it('should call onClose when close button is clicked', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()

      render(
        <FullScreenModal open={true} closable={true} onClose={onClose}>
          Content
        </FullScreenModal>,
      )

      const closeBtn = document.querySelector('.bg-components-button-tertiary-bg')
      expect(closeBtn).toBeInTheDocument()

      await user.click(closeBtn!)
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('should call onClose when clicking the backdrop', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()

      render(
        <FullScreenModal open={true} onClose={onClose}>
          <div data-testid="inner">Content</div>
        </FullScreenModal>,
      )

      const dialog = document.querySelector('.modal-dialog')
      if (dialog) {
        await user.click(dialog)
        expect(onClose).toHaveBeenCalled()
      }
      else {
        throw new Error('Dialog root not found')
      }
    })

    it('should call onClose when Escape key is pressed', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()

      render(
        <FullScreenModal open={true} onClose={onClose}>
          Content
        </FullScreenModal>,
      )

      await user.keyboard('{Escape}')
      expect(onClose).toHaveBeenCalled()
    })

    it('should not call onClose when clicking inside the content', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()

      render(
        <FullScreenModal open={true} onClose={onClose}>
          <div className="bg-background-default-subtle">
            <button>Action</button>
          </div>
        </FullScreenModal>,
      )

      const innerButton = screen.getByRole('button', { name: 'Action' })
      await user.click(innerButton)
      expect(onClose).not.toHaveBeenCalled()

      const contentPanel = document.querySelector('.bg-background-default-subtle')
      await act(async () => {
        fireEvent.click(contentPanel!)
      })
      expect(onClose).not.toHaveBeenCalled()
    })
  })

  describe('Default Props', () => {
    it('should not throw if onClose is not provided', async () => {
      const user = userEvent.setup()
      render(<FullScreenModal open={true} closable={true}>Content</FullScreenModal>)

      const closeButton = document.querySelector('.bg-components-button-tertiary-bg')
      await user.click(closeButton!)
    })
  })
})
