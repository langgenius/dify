import type * as React from 'react'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { IconButton } from '../../icon-button'
import {
  Drawer,
  DrawerBackdrop,
  DrawerClose,
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
  it('should keep the drawer open when its composed close control is disabled', async () => {
    const onOpenChange = vi.fn()
    const screen = await render(
      <Drawer defaultOpen onOpenChange={onOpenChange}>
        <DrawerPortal>
          <DrawerViewport>
            <DrawerPopup>
              <DrawerTitle>Settings</DrawerTitle>
              <DrawerClose
                disabled
                render={
                  <IconButton aria-label="Close drawer" size="md">
                    <span aria-hidden="true" className="i-ri-close-line size-4" />
                  </IconButton>
                }
              />
            </DrawerPopup>
          </DrawerViewport>
        </DrawerPortal>
      </Drawer>,
    )
    const closeButton = screen.getByRole('button', { name: 'Close drawer' })
    await expect.element(closeButton).toBeDisabled()
    await closeButton.click({ force: true })
    await expect.element(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  describe('User Interactions', () => {
    it.each(['click', '{Enter}', ' '])(
      'should close a portalled drawer with %s without submitting and restore focus',
      async (activation) => {
        const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault())
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
                    <form onSubmit={onSubmit}>
                      <DrawerClose
                        render={
                          <IconButton aria-label="Close drawer" size="md">
                            <span aria-hidden="true" className="i-ri-close-line size-4" />
                          </IconButton>
                        }
                      />
                    </form>
                  </DrawerContent>
                </DrawerPopup>
              </DrawerViewport>
            </DrawerPortal>
          </Drawer>,
        )

        expect(document.body.querySelector('[role="dialog"]')).not.toBeInTheDocument()

        await screen.getByRole('button', { name: 'Open settings' }).click()

        await vi.waitFor(() => {
          expect(document.body.querySelector('[role="dialog"]')).toBeInTheDocument()
        })

        const dialog = asHTMLElement(document.body.querySelector('[role="dialog"]')!)
        expect(document.body).toContainElement(dialog)
        expect(screen.container).not.toContainElement(dialog)
        await expect
          .element(screen.getByRole('dialog', { name: 'Settings' }))
          .toHaveAccessibleDescription('Configure the current workspace.')
        await expect.element(screen.getByText('Workspace controls')).toBeInTheDocument()
        await expect.element(screen.getByTestId('drawer-backdrop')).toBeInTheDocument()

        const closeButton = screen.getByRole('button', { name: 'Close drawer' })
        if (activation === 'click') {
          await closeButton.click()
        } else {
          await userEvent.tab()
          await expect.element(closeButton).toHaveFocus()
          await userEvent.keyboard(activation)
        }
        expect(onSubmit).not.toHaveBeenCalled()

        await vi.waitFor(() => {
          expect(document.body.querySelector('[role="dialog"]')).not.toBeInTheDocument()
        })
        await expect.element(screen.getByRole('button', { name: 'Open settings' })).toHaveFocus()
      },
    )
  })
})
