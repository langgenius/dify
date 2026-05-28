import { render } from 'vitest-browser-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '..'

const renderWithSafeViewport = (ui: import('react').ReactNode) => render(
  <div style={{ minHeight: '100vh', minWidth: '100vw', padding: '240px' }}>
    {ui}
  </div>,
)

describe('PopoverContent', () => {
  describe('Placement', () => {
    it('should use bottom placement and default offsets when placement props are not provided', async () => {
      const screen = await renderWithSafeViewport(
        <Popover open>
          <PopoverTrigger aria-label="popover trigger">Open</PopoverTrigger>
          <PopoverContent
            positionerProps={{ 'role': 'group', 'aria-label': 'default positioner' }}
            popupProps={{ 'role': 'dialog', 'aria-label': 'default popover' }}
          >
            <span>Default content</span>
          </PopoverContent>
        </Popover>,
      )

      await expect.element(screen.getByRole('group', { name: 'default positioner' })).toHaveAttribute('data-side', 'bottom')
      await expect.element(screen.getByRole('group', { name: 'default positioner' })).toHaveAttribute('data-align', 'center')
      await expect.element(screen.getByRole('dialog', { name: 'default popover' })).toHaveTextContent('Default content')
    })

    it('should apply parsed custom placement and custom offsets when placement props are provided', async () => {
      const screen = await renderWithSafeViewport(
        <Popover open>
          <PopoverTrigger aria-label="popover trigger">Open</PopoverTrigger>
          <PopoverContent
            placement="top-end"
            sideOffset={14}
            alignOffset={6}
            positionerProps={{ 'role': 'group', 'aria-label': 'custom positioner' }}
            popupProps={{ 'role': 'dialog', 'aria-label': 'custom popover' }}
          >
            <span>Custom placement content</span>
          </PopoverContent>
        </Popover>,
      )

      await expect.element(screen.getByRole('group', { name: 'custom positioner' })).toHaveAttribute('data-side', 'top')
      await expect.element(screen.getByRole('group', { name: 'custom positioner' })).toHaveAttribute('data-align', 'end')
      await expect.element(screen.getByRole('dialog', { name: 'custom popover' })).toHaveTextContent('Custom placement content')
    })
  })

  describe('Passthrough props', () => {
    it('should forward positionerProps and popupProps when passthrough props are provided', async () => {
      const onPopupClick = vi.fn()

      const screen = await render(
        <Popover open>
          <PopoverTrigger aria-label="popover trigger">Open</PopoverTrigger>
          <PopoverContent
            positionerProps={{
              'role': 'group',
              'aria-label': 'popover positioner',
              'id': 'popover-positioner-id',
            }}
            popupProps={{
              'id': 'popover-popup-id',
              'role': 'dialog',
              'aria-label': 'popover content',
              'onClick': onPopupClick,
            }}
          >
            <span>Popover body</span>
          </PopoverContent>
        </Popover>,
      )

      const popup = screen.getByRole('dialog', { name: 'popover content' })
      await popup.click()

      await expect.element(screen.getByRole('group', { name: 'popover positioner' })).toHaveAttribute('id', 'popover-positioner-id')
      await expect.element(popup).toHaveAttribute('id', 'popover-popup-id')
      expect(onPopupClick).toHaveBeenCalledTimes(1)
    })
  })
})
