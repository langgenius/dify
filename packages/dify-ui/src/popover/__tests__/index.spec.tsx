import type * as React from 'react'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverPopup,
  PopoverPortal,
  PopoverPositioner,
  PopoverTitle,
  PopoverTrigger,
} from '..'

const renderWithSafeViewport = (ui: React.ReactNode) =>
  render(<div style={{ minHeight: '100vh', minWidth: '100vw', padding: '240px' }}>{ui}</div>)

describe('PopoverContent', () => {
  describe('Animation', () => {
    it('should restore focus without waiting for an instant close transition', async () => {
      const animationSettings = globalThis as typeof globalThis & {
        BASE_UI_ANIMATIONS_DISABLED: boolean
      }
      const animationsDisabled = animationSettings.BASE_UI_ANIMATIONS_DISABLED
      animationSettings.BASE_UI_ANIMATIONS_DISABLED = false

      try {
        const screen = await renderWithSafeViewport(
          <Popover>
            <PopoverTrigger>Open</PopoverTrigger>
            <PopoverContent popupClassName="duration-[30s]">
              <PopoverTitle>Popover content</PopoverTitle>
              <button type="button">Focusable content</button>
            </PopoverContent>
          </Popover>,
        )

        const trigger = screen.getByRole('button', { name: 'Open' })
        await trigger.click()

        const focusableContent = screen.getByRole('button', { name: 'Focusable content' })
        focusableContent.element().focus()
        await expect.element(focusableContent).toHaveFocus()

        await userEvent.keyboard('{Escape}')

        await expect.element(trigger).toHaveFocus()
      } finally {
        animationSettings.BASE_UI_ANIMATIONS_DISABLED = animationsDisabled
      }
    })
  })

  describe('Placement', () => {
    it('should use bottom placement and default offsets when placement props are not provided', async () => {
      const screen = await renderWithSafeViewport(
        <Popover open>
          <PopoverTrigger>Open</PopoverTrigger>
          <PopoverContent positionerProps={{ id: 'default-positioner' }}>
            <PopoverTitle>Default popover</PopoverTitle>
            <span>Default content</span>
          </PopoverContent>
        </Popover>,
      )

      await expect
        .element(document.getElementById('default-positioner')!)
        .toHaveAttribute('data-side', 'bottom')
      await expect
        .element(document.getElementById('default-positioner')!)
        .toHaveAttribute('data-align', 'center')
      const popup = screen.getByRole('dialog', { name: 'default popover' })
      await expect.element(popup).toHaveTextContent('Default content')
      await expect.element(popup).toHaveClass('rounded-xl', 'bg-components-panel-bg', 'shadow-lg')
    })

    it('should apply parsed custom placement and custom offsets when placement props are provided', async () => {
      const screen = await renderWithSafeViewport(
        <Popover open>
          <PopoverTrigger>Open</PopoverTrigger>
          <PopoverContent
            placement="top-end"
            sideOffset={14}
            alignOffset={6}
            positionerProps={{ id: 'custom-positioner' }}
          >
            <PopoverTitle>Custom popover</PopoverTitle>
            <span>Custom placement content</span>
          </PopoverContent>
        </Popover>,
      )

      await expect
        .element(document.getElementById('custom-positioner')!)
        .toHaveAttribute('data-side', 'top')
      await expect
        .element(document.getElementById('custom-positioner')!)
        .toHaveAttribute('data-align', 'end')
      await expect
        .element(screen.getByRole('dialog', { name: 'custom popover' }))
        .toHaveTextContent('Custom placement content')
    })
  })

  describe('Passthrough props', () => {
    it('should forward positionerProps and popupProps when passthrough props are provided', async () => {
      const onPopupClick = vi.fn()

      const screen = await render(
        <Popover open>
          <PopoverTrigger>Open</PopoverTrigger>
          <PopoverContent
            positionerProps={{
              id: 'popover-positioner-id',
            }}
            popupProps={{
              id: 'popover-popup-id',
              onClick: onPopupClick,
            }}
          >
            <PopoverTitle>Popover content</PopoverTitle>
            <span>Popover body</span>
          </PopoverContent>
        </Popover>,
      )

      const popup = screen.getByRole('dialog', { name: 'popover content' })
      await popup.click()

      await expect
        .element(document.getElementById('popover-positioner-id')!)
        .toHaveAttribute('id', 'popover-positioner-id')
      await expect.element(popup).toHaveAttribute('id', 'popover-popup-id')
      expect(onPopupClick).toHaveBeenCalledTimes(1)
    })
  })
})

describe('Popover anatomy', () => {
  it('should compose the portal, positioner, and popup directly', async () => {
    const screen = await renderWithSafeViewport(
      <Popover open>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverPortal>
          <PopoverPositioner placement="top-end" data-testid="anatomy-positioner">
            <PopoverPopup>
              <PopoverTitle>Anatomy popover</PopoverTitle>
              <PopoverDescription>Anatomy content</PopoverDescription>
            </PopoverPopup>
          </PopoverPositioner>
        </PopoverPortal>
      </Popover>,
    )

    await expect
      .element(screen.getByTestId('anatomy-positioner'))
      .toHaveAttribute('data-side', 'top')
    await expect
      .element(screen.getByTestId('anatomy-positioner'))
      .toHaveAttribute('data-align', 'end')
    const popup = screen.getByRole('dialog', { name: 'Anatomy popover' })
    await expect.element(popup).toHaveTextContent('Anatomy content')
    await expect.element(popup).toHaveClass('outline-hidden')
    await expect.element(popup).not.toHaveClass('rounded-xl', 'bg-components-panel-bg', 'shadow-lg')
  })
})
