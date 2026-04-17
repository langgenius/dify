import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../index'

describe('Dialog wrapper', () => {
  describe('Rendering', () => {
    it('should render dialog content when dialog is open', () => {
      render(
        <Dialog open>
          <DialogContent>
            <DialogTitle>Dialog Title</DialogTitle>
            <DialogDescription>Dialog Description</DialogDescription>
          </DialogContent>
        </Dialog>,
      )

      const dialog = screen.getByRole('dialog')
      expect(dialog).toHaveTextContent('Dialog Title')
      expect(dialog).toHaveTextContent('Dialog Description')
    })
  })

  describe('Props', () => {
    it('should not render close button when DialogCloseButton is not provided', () => {
      render(
        <Dialog open>
          <DialogContent>
            <span>Dialog body</span>
          </DialogContent>
        </Dialog>,
      )

      expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
    })

    it('should render explicit close button with custom aria-label', () => {
      render(
        <Dialog open>
          <DialogContent>
            <DialogCloseButton aria-label="Dismiss dialog" />
            <span>Dialog body</span>
          </DialogContent>
        </Dialog>,
      )

      expect(screen.getByRole('button', { name: 'Dismiss dialog' })).toBeInTheDocument()
    })

    it('should render default close button label when aria-label is omitted', () => {
      render(
        <Dialog open>
          <DialogContent>
            <DialogCloseButton />
            <span>Dialog body</span>
          </DialogContent>
        </Dialog>,
      )

      expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
    })

    it('should forward close button props to base primitive', () => {
      const onClick = vi.fn()
      render(
        <Dialog open>
          <DialogContent>
            <DialogCloseButton data-testid="close-button" disabled onClick={onClick} />
            <span>Dialog body</span>
          </DialogContent>
        </Dialog>,
      )

      const closeButton = screen.getByTestId('close-button')
      expect(closeButton).toBeDisabled()
      fireEvent.click(closeButton)
      expect(onClick).not.toHaveBeenCalled()
    })
  })
})
