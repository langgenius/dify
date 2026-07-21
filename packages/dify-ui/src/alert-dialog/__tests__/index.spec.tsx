import { render } from 'vitest-browser-react'
import { AlertDialog, AlertDialogActions, AlertDialogContent, AlertDialogTitle } from '../index'

describe('AlertDialog wrapper', () => {
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

  describe('Composition Helpers', () => {
    it('should forward className to the actions wrapper', async () => {
      const screen = await render(
        <AlertDialog open>
          <AlertDialogContent>
            <AlertDialogTitle>Action Required</AlertDialogTitle>
            <AlertDialogActions data-testid="actions" className="custom-actions" />
          </AlertDialogContent>
        </AlertDialog>,
      )

      await expect.element(screen.getByTestId('actions')).toHaveClass('custom-actions')
    })
  })
})
