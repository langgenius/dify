import * as React from 'react'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import {
  Popover,
  PopoverBackdrop,
  PopoverClose,
  PopoverContent,
  PopoverDescription,
  PopoverPopup,
  PopoverPortal,
  PopoverPositioner,
  PopoverTitle,
  PopoverTrigger,
} from '..'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../dropdown-menu'

const renderWithSafeViewport = (ui: React.ReactNode) =>
  render(<div style={{ minHeight: '100vh', minWidth: '100vw', padding: '240px' }}>{ui}</div>)

describe('PopoverContent', () => {
  describe('Popup props', () => {
    it('should move focus to the requested initial target', async () => {
      const initialFocusRef = React.createRef<HTMLButtonElement>()
      const screen = await renderWithSafeViewport(
        <Popover open>
          <PopoverTrigger>Open</PopoverTrigger>
          <PopoverContent initialFocus={initialFocusRef}>
            <PopoverTitle>Popover content</PopoverTitle>
            <button ref={initialFocusRef} type="button">
              Focus target
            </button>
          </PopoverContent>
        </Popover>,
      )

      await expect.element(screen.getByRole('button', { name: 'Focus target' })).toHaveFocus()
    })
  })

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
            <PopoverContent className="duration-[30s]">
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
        expect(trigger.element().matches(':focus-visible')).toBe(true)
      } finally {
        animationSettings.BASE_UI_ANIMATIONS_DISABLED = animationsDisabled
      }
    })
  })

  describe('Surface', () => {
    it('should provide the default popover surface', async () => {
      const screen = await renderWithSafeViewport(
        <Popover open>
          <PopoverTrigger>Open</PopoverTrigger>
          <PopoverContent
            // Verify both Dify wrapper layers resolve the popup callback before merging classes.
            className={(state) => (state.open ? 'w-48' : undefined)}
            render={<section className="p-2" />}
          >
            <PopoverTitle>Default popover</PopoverTitle>
            <span>Default content</span>
          </PopoverContent>
        </Popover>,
      )

      const popup = screen.getByRole('dialog', { name: 'default popover' })
      await expect.element(popup).toHaveTextContent('Default content')
      const popupStyle = getComputedStyle(popup.element())
      expect(popupStyle.borderTopWidth).not.toBe('0px')
      expect(popupStyle.borderTopLeftRadius).not.toBe('0px')
      expect(popupStyle.backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
      expect(popupStyle.boxShadow).not.toBe('none')
      expect(popupStyle.width).toBe('192px')
      expect(popupStyle.paddingTop).toBe('8px')
    })
  })
})

describe('Popover anatomy', () => {
  it('places the backdrop above a parent menu and below the interactive popup', async () => {
    const backdropRef = React.createRef<HTMLDivElement>()
    const screen = await renderWithSafeViewport(
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Primary action</DropdownMenuItem>
          <Popover modal="trap-focus">
            <DropdownMenuItem
              closeOnClick={false}
              render={<PopoverTrigger nativeButton={false} render={<div />} />}
            >
              More options
            </DropdownMenuItem>
            <PopoverPortal>
              <PopoverBackdrop ref={backdropRef} />
              <PopoverPositioner placement="right-start">
                <PopoverPopup>
                  <PopoverTitle>More options</PopoverTitle>
                  <input aria-label="Filter options" />
                  <PopoverClose>Close</PopoverClose>
                </PopoverPopup>
              </PopoverPositioner>
            </PopoverPortal>
          </Popover>
        </DropdownMenuContent>
      </DropdownMenu>,
    )

    await screen.getByRole('button', { name: 'Actions' }).click()
    const primaryAction = screen.getByRole('menuitem', { name: 'Primary action' }).element()
    await screen.getByRole('menuitem', { name: 'More options' }).click()
    const input = screen.getByRole('textbox', { name: 'Filter options' })

    const { x, y, width, height } = primaryAction.getBoundingClientRect()
    expect(document.elementFromPoint(x + width / 2, y + height / 2)).toBe(backdropRef.current)
    await input.click()
    await input.fill('Example')
    await expect.element(input).toHaveValue('Example')
  })

  it('should use the default positioner placement', async () => {
    const screen = await renderWithSafeViewport(
      <Popover open>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverPortal>
          <PopoverPositioner data-testid="default-positioner">
            <PopoverPopup>
              <PopoverTitle>Default anatomy popover</PopoverTitle>
            </PopoverPopup>
          </PopoverPositioner>
        </PopoverPortal>
      </Popover>,
    )

    await expect
      .element(screen.getByTestId('default-positioner'))
      .toHaveAttribute('data-side', 'bottom')
    await expect
      .element(screen.getByTestId('default-positioner'))
      .toHaveAttribute('data-align', 'center')
  })

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
    const popupStyle = getComputedStyle(popup.element())
    expect(popupStyle.borderTopWidth).toBe('0px')
    expect(popupStyle.borderTopLeftRadius).toBe('0px')
    expect(popupStyle.backgroundColor).toBe('rgba(0, 0, 0, 0)')
    expect(popupStyle.boxShadow).toBe('none')
    expect(popupStyle.paddingTop).toBe('0px')
    expect(popupStyle.overflow).toBe('visible')
  })
})
