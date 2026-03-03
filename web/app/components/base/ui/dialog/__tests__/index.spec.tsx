import { Dialog as BaseDialog } from '@base-ui/react/dialog'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
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
    it('should not render close button when closable is omitted', () => {
      render(
        <Dialog open>
          <DialogContent>
            <span>Dialog body</span>
          </DialogContent>
        </Dialog>,
      )

      expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
    })

    it('should render close button when closable is true', () => {
      render(
        <Dialog open>
          <DialogContent closable>
            <span>Dialog body</span>
          </DialogContent>
        </Dialog>,
      )

      const dialog = screen.getByRole('dialog')
      const closeButton = screen.getByRole('button', { name: 'Close' })

      expect(dialog).toContainElement(closeButton)
      expect(closeButton).toHaveAttribute('aria-label', 'Close')
    })
  })

  describe('Exports', () => {
    it('should map dialog aliases to the matching base dialog primitives', () => {
      expect(Dialog).toBe(BaseDialog.Root)
      expect(DialogTrigger).toBe(BaseDialog.Trigger)
      expect(DialogTitle).toBe(BaseDialog.Title)
      expect(DialogDescription).toBe(BaseDialog.Description)
      expect(DialogClose).toBe(BaseDialog.Close)
    })
  })
})
