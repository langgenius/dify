import { render } from 'vitest-browser-react'
import {
  Drawer,
  DrawerBackdrop,
  DrawerCloseButton,
  DrawerContent,
  DrawerDescription,
  DrawerPopup,
  DrawerPortal,
  DrawerTitle,
  DrawerTrigger,
  DrawerViewport,
} from '../index'

const asHTMLElement = (element: HTMLElement | SVGElement) => element as HTMLElement

describe('Drawer wrapper', () => {
  describe('User Interactions', () => {
    it('should open a portalled drawer and close it with the default close button', async () => {
      const screen = await render(
        <Drawer>
          <DrawerTrigger>Open settings</DrawerTrigger>
          <DrawerPortal>
            <DrawerBackdrop data-testid="drawer-backdrop" />
            <DrawerViewport>
              <DrawerPopup>
                <DrawerTitle>Settings</DrawerTitle>
                <DrawerDescription>Configure the current workspace.</DrawerDescription>
                <DrawerContent>
                  <p>Workspace controls</p>
                  <DrawerCloseButton />
                </DrawerContent>
              </DrawerPopup>
            </DrawerViewport>
          </DrawerPortal>
        </Drawer>,
      )

      expect(document.body.querySelector('[role="dialog"]')).not.toBeInTheDocument()

      asHTMLElement(screen.getByRole('button', { name: 'Open settings' }).element()).click()

      await vi.waitFor(() => {
        expect(document.body.querySelector('[role="dialog"]')).toBeInTheDocument()
      })

      const dialog = asHTMLElement(document.body.querySelector('[role="dialog"]')!)
      expect(document.body).toContainElement(dialog)
      expect(screen.container).not.toContainElement(dialog)
      await expect.element(dialog).toHaveTextContent('Workspace controls')
      await expect.element(screen.getByText('Configure the current workspace.')).toBeInTheDocument()
      await expect.element(screen.getByTestId('drawer-backdrop')).toHaveClass('z-1002')

      asHTMLElement(screen.getByRole('button', { name: 'Close drawer' }).element()).click()

      await vi.waitFor(() => {
        expect(document.body.querySelector('[role="dialog"]')).not.toBeInTheDocument()
      })
    })
  })
})
