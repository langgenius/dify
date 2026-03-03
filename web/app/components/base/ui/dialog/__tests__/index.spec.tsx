import { Dialog as BaseDialog } from '@base-ui/react/dialog'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  Dialog,
  DialogClose,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
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

    it('should render explicit close button with custom label', () => {
      render(
        <Dialog open>
          <DialogContent>
            <DialogCloseButton ariaLabel="Dismiss dialog" />
            <span>Dialog body</span>
          </DialogContent>
        </Dialog>,
      )

      expect(screen.getByRole('button', { name: 'Dismiss dialog' })).toBeInTheDocument()
    })

    it('should render default close button label when ariaLabel is omitted', () => {
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
  })

  describe('Exports', () => {
    it('should map dialog aliases to the matching base dialog primitives', () => {
      expect(Dialog).toBe(BaseDialog.Root)
      expect(DialogTrigger).toBe(BaseDialog.Trigger)
      expect(DialogTitle).toBe(BaseDialog.Title)
      expect(DialogDescription).toBe(BaseDialog.Description)
      expect(DialogClose).toBe(BaseDialog.Close)
      expect(DialogPortal).toBe(BaseDialog.Portal)
    })
  })
})
