import { render } from 'vitest-browser-react'
import { IconButton } from '../../icon-button'
import {
  createDialogHandle,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '../index'

describe('Dialog wrapper', () => {
  describe('Rendering', () => {
    it('should render dialog content when dialog is open', async () => {
      const screen = await render(
        <Dialog open>
          <DialogContent>
            <DialogTitle>Dialog Title</DialogTitle>
            <DialogDescription>Dialog Description</DialogDescription>
          </DialogContent>
        </Dialog>,
      )

      await expect.element(screen.getByRole('dialog')).toHaveTextContent('Dialog Title')
      await expect.element(screen.getByRole('dialog')).toHaveTextContent('Dialog Description')
    })

    it('should connect a detached trigger to the dialog', async () => {
      const handle = createDialogHandle()
      const screen = await render(
        <>
          <DialogTrigger handle={handle}>Open dialog</DialogTrigger>
          <Dialog handle={handle}>
            <DialogContent>
              <DialogTitle>Detached dialog</DialogTitle>
            </DialogContent>
          </Dialog>
        </>,
      )

      await screen.getByRole('button', { name: 'Open dialog' }).click()

      await expect
        .element(screen.getByRole('dialog', { name: 'Detached dialog' }))
        .toBeInTheDocument()
    })
  })

  describe('Composition', () => {
    it('should compose an explicitly named IconButton as the close control', async () => {
      const screen = await render(
        <Dialog open>
          <DialogContent>
            <DialogClose
              render={
                <IconButton
                  aria-label="Dismiss dialog"
                  size="lg"
                  className="absolute inset-e-6 top-6"
                >
                  <span aria-hidden className="i-ri-close-line size-4" />
                </IconButton>
              }
            />
            <span>Dialog body</span>
          </DialogContent>
        </Dialog>,
      )

      await expect
        .element(screen.getByRole('button', { name: 'Dismiss dialog' }))
        .toBeInTheDocument()
    })

    it('should close the dialog when the composed close control is activated', async () => {
      const screen = await render(
        <Dialog defaultOpen>
          <DialogContent>
            <DialogClose
              render={
                <IconButton
                  aria-label="Close dialog"
                  size="lg"
                  className="absolute inset-e-6 top-6"
                >
                  <span aria-hidden className="i-ri-close-line size-4" />
                </IconButton>
              }
            />
            <span>Dialog body</span>
          </DialogContent>
        </Dialog>,
      )

      await screen.getByRole('button', { name: 'Close dialog' }).click()

      await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
    })

    it('should preserve the disabled state of a composed close control', async () => {
      const screen = await render(
        <Dialog open>
          <DialogContent>
            <DialogClose
              render={
                <IconButton
                  aria-label="Close dialog"
                  size="lg"
                  className="absolute inset-e-6 top-6"
                  disabled
                >
                  <span aria-hidden className="i-ri-close-line size-4" />
                </IconButton>
              }
            />
            <span>Dialog body</span>
          </DialogContent>
        </Dialog>,
      )

      await expect.element(screen.getByRole('button', { name: 'Close dialog' })).toBeDisabled()
    })
  })
})
