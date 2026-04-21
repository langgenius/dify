import { render } from 'vitest-browser-react'
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

const asHTMLElement = (element: HTMLElement | SVGElement) => element as HTMLElement

describe('AlertDialog wrapper', () => {
  describe('Rendering', () => {
    it('should render alert dialog content when dialog is open', async () => {
      const screen = await render(
        <AlertDialog open>
          <AlertDialogContent>
            <AlertDialogTitle>Confirm Delete</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
          </AlertDialogContent>
        </AlertDialog>,
      )

      await expect.element(screen.getByRole('alertdialog')).toHaveTextContent('Confirm Delete')
      await expect.element(screen.getByRole('alertdialog')).toHaveTextContent('This action cannot be undone.')
    })

    it('should not render content when dialog is closed', async () => {
      const screen = await render(
        <AlertDialog open={false}>
          <AlertDialogContent>
            <AlertDialogTitle>Hidden Title</AlertDialogTitle>
          </AlertDialogContent>
        </AlertDialog>,
      )

      expect(screen.container.querySelector('[role="alertdialog"]')).not.toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should apply custom className to popup', async () => {
      const screen = await render(
        <AlertDialog open>
          <AlertDialogContent className="custom-class">
            <AlertDialogTitle>Title</AlertDialogTitle>
          </AlertDialogContent>
        </AlertDialog>,
      )

      await expect.element(screen.getByRole('alertdialog')).toHaveClass('custom-class')
    })

    it('should not render a close button by default', async () => {
      const screen = await render(
        <AlertDialog open>
          <AlertDialogContent>
            <AlertDialogTitle>Title</AlertDialogTitle>
          </AlertDialogContent>
        </AlertDialog>,
      )

      expect(() => screen.getByRole('button', { name: 'Close' }).element()).toThrow()
    })
  })

  describe('User Interactions', () => {
    it('should open and close dialog when trigger and cancel button are clicked', async () => {
      const screen = await render(
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

      expect(screen.container.querySelector('[role="alertdialog"]')).not.toBeInTheDocument()

      asHTMLElement(screen.getByRole('button', { name: 'Open Dialog' }).element()).click()
      await expect.element(screen.getByRole('alertdialog')).toHaveTextContent('Action Required')

      asHTMLElement(screen.getByRole('button', { name: 'Cancel' }).element()).click()
      await vi.waitFor(() => {
        expect(screen.container.querySelector('[role="alertdialog"]')).not.toBeInTheDocument()
      })
    })
  })

  describe('Composition Helpers', () => {
    it('should render actions wrapper and default confirm button styles', async () => {
      const screen = await render(
        <AlertDialog open>
          <AlertDialogContent>
            <AlertDialogTitle>Action Required</AlertDialogTitle>
            <AlertDialogActions data-testid="actions" className="custom-actions">
              <AlertDialogConfirmButton>Confirm</AlertDialogConfirmButton>
            </AlertDialogActions>
          </AlertDialogContent>
        </AlertDialog>,
      )

      await expect.element(screen.getByTestId('actions')).toHaveClass('flex', 'items-start', 'justify-end', 'gap-2', 'self-stretch', 'p-6', 'custom-actions')
      await expect.element(screen.getByRole('button', { name: 'Confirm' })).toHaveClass('bg-components-button-destructive-primary-bg')
    })

    it('should keep dialog open after confirm click and close via cancel helper', async () => {
      const onConfirm = vi.fn()

      const screen = await render(
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

      asHTMLElement(screen.getByRole('button', { name: 'Open Dialog' }).element()).click()
      await expect.element(screen.getByRole('alertdialog')).toBeInTheDocument()

      asHTMLElement(screen.getByRole('button', { name: 'Confirm' }).element()).click()
      expect(onConfirm).toHaveBeenCalledTimes(1)
      await expect.element(screen.getByRole('alertdialog')).toBeInTheDocument()

      asHTMLElement(screen.getByRole('button', { name: 'Cancel' }).element()).click()
      await vi.waitFor(() => {
        expect(screen.container.querySelector('[role="alertdialog"]')).not.toBeInTheDocument()
      })
    })
  })
})
