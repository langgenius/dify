import { render } from 'vitest-browser-react'
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../index'

const asHTMLElement = (element: HTMLElement | SVGElement) => element as HTMLElement

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
  })

  describe('Props', () => {
    it('should not render close button when DialogCloseButton is not provided', async () => {
      const screen = await render(
        <Dialog open>
          <DialogContent>
            <span>Dialog body</span>
          </DialogContent>
        </Dialog>,
      )

      expect(() => screen.getByRole('button', { name: 'Close' }).element()).toThrow()
    })

    it('should render explicit close button with custom aria-label', async () => {
      const screen = await render(
        <Dialog open>
          <DialogContent>
            <DialogCloseButton aria-label="Dismiss dialog" />
            <span>Dialog body</span>
          </DialogContent>
        </Dialog>,
      )

      await expect.element(screen.getByRole('button', { name: 'Dismiss dialog' })).toBeInTheDocument()
    })

    it('should render default close button label when aria-label is omitted', async () => {
      const screen = await render(
        <Dialog open>
          <DialogContent>
            <DialogCloseButton />
            <span>Dialog body</span>
          </DialogContent>
        </Dialog>,
      )

      await expect.element(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
    })

    it('should forward close button props to base primitive', async () => {
      const onClick = vi.fn()
      const screen = await render(
        <Dialog open>
          <DialogContent>
            <DialogCloseButton data-testid="close-button" disabled onClick={onClick} />
            <span>Dialog body</span>
          </DialogContent>
        </Dialog>,
      )

      const closeButton = screen.getByTestId('close-button')
      await expect.element(closeButton).toBeDisabled()
      asHTMLElement(closeButton.element()).click()
      expect(onClick).not.toHaveBeenCalled()
    })
  })
})
