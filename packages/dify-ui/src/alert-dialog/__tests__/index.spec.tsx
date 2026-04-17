import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '../index'

describe('AlertDialog wrapper', () => {
  describe('Rendering', () => {
    it('should render alert dialog content when dialog is open', () => {
      render(
        <AlertDialog open>
          <AlertDialogContent>
            <AlertDialogTitle>Confirm Delete</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
          </AlertDialogContent>
        </AlertDialog>,
      )

      const dialog = screen.getByRole('alertdialog')
      expect(dialog).toHaveTextContent('Confirm Delete')
      expect(dialog).toHaveTextContent('This action cannot be undone.')
    })

    it('should not render content when dialog is closed', () => {
      render(
        <AlertDialog open={false}>
          <AlertDialogContent>
            <AlertDialogTitle>Hidden Title</AlertDialogTitle>
          </AlertDialogContent>
        </AlertDialog>,
      )

      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should apply custom className to popup', () => {
      render(
        <AlertDialog open>
          <AlertDialogContent className="custom-class">
            <AlertDialogTitle>Title</AlertDialogTitle>
          </AlertDialogContent>
        </AlertDialog>,
      )

      const dialog = screen.getByRole('alertdialog')
      expect(dialog).toHaveClass('custom-class')
    })

    it('should not render a close button by default', () => {
      render(
        <AlertDialog open>
          <AlertDialogContent>
            <AlertDialogTitle>Title</AlertDialogTitle>
          </AlertDialogContent>
        </AlertDialog>,
      )

      expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should open and close dialog when trigger and cancel button are clicked', async () => {
      render(
        <AlertDialog>
          <AlertDialogTrigger>Open Dialog</AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogTitle>Action Required</AlertDialogTitle>
            <AlertDialogDescription>Please confirm the action.</AlertDialogDescription>
            <AlertDialogActions>
              <AlertDialogCancelButton>Cancel</AlertDialogCancelButton>
            </AlertDialogActions>
          </AlertDialogContent>
        </AlertDialog>,
      )

      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Open Dialog' }))
      expect(await screen.findByRole('alertdialog')).toHaveTextContent('Action Required')

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      await waitFor(() => {
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      })
    })
  })

  describe('Composition Helpers', () => {
    it('should render actions wrapper and default confirm button styles', () => {
      render(
        <AlertDialog open>
          <AlertDialogContent>
            <AlertDialogTitle>Action Required</AlertDialogTitle>
            <AlertDialogActions data-testid="actions" className="custom-actions">
              <AlertDialogConfirmButton>Confirm</AlertDialogConfirmButton>
            </AlertDialogActions>
          </AlertDialogContent>
        </AlertDialog>,
      )

      expect(screen.getByTestId('actions')).toHaveClass('flex', 'items-start', 'justify-end', 'gap-2', 'self-stretch', 'p-6', 'custom-actions')
      const confirmButton = screen.getByRole('button', { name: 'Confirm' })
      expect(confirmButton).toHaveClass('bg-components-button-destructive-primary-bg')
    })

    it('should keep dialog open after confirm click and close via cancel helper', async () => {
      const onConfirm = vi.fn()

      render(
        <AlertDialog>
          <AlertDialogTrigger>Open Dialog</AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogTitle>Action Required</AlertDialogTitle>
            <AlertDialogActions>
              <AlertDialogCancelButton>Cancel</AlertDialogCancelButton>
              <AlertDialogConfirmButton onClick={onConfirm}>Confirm</AlertDialogConfirmButton>
            </AlertDialogActions>
          </AlertDialogContent>
        </AlertDialog>,
      )

      fireEvent.click(screen.getByRole('button', { name: 'Open Dialog' }))
      expect(await screen.findByRole('alertdialog')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
      expect(onConfirm).toHaveBeenCalledTimes(1)
      expect(screen.getByRole('alertdialog')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      await waitFor(() => {
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      })
    })
  })
})
