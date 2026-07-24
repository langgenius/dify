import { Popover as BasePopover } from '@base-ui/react/popover'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from '..'

describe('PopoverContent', () => {
  describe('Placement', () => {
    it('should use bottom placement and default offsets when placement props are not provided', () => {
      render(
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

      const positioner = screen.getByRole('group', { name: 'default positioner' })
      const popup = screen.getByRole('dialog', { name: 'default popover' })

      expect(positioner).toHaveAttribute('data-side', 'bottom')
      expect(positioner).toHaveAttribute('data-align', 'center')
      expect(popup).toHaveTextContent('Default content')
    })

    it('should apply parsed custom placement and custom offsets when placement props are provided', () => {
      render(
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

      const positioner = screen.getByRole('group', { name: 'custom positioner' })
      const popup = screen.getByRole('dialog', { name: 'custom popover' })

      expect(positioner).toHaveAttribute('data-side', 'top')
      expect(positioner).toHaveAttribute('data-align', 'end')
      expect(popup).toHaveTextContent('Custom placement content')
    })
  })

  describe('Passthrough props', () => {
    it('should forward positionerProps and popupProps when passthrough props are provided', () => {
      const onPopupClick = vi.fn()

      render(
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

      const positioner = screen.getByRole('group', { name: 'popover positioner' })
      const popup = screen.getByRole('dialog', { name: 'popover content' })
      fireEvent.click(popup)

      expect(positioner).toHaveAttribute('id', 'popover-positioner-id')
      expect(popup).toHaveAttribute('id', 'popover-popup-id')
      expect(onPopupClick).toHaveBeenCalledTimes(1)
    })
  })
})

describe('Popover aliases', () => {
  describe('Export mapping', () => {
    it('should map aliases to the matching base popover primitives when wrapper exports are imported', () => {
      expect(Popover).toBe(BasePopover.Root)
      expect(PopoverTrigger).toBe(BasePopover.Trigger)
      expect(PopoverClose).toBe(BasePopover.Close)
      expect(PopoverTitle).toBe(BasePopover.Title)
      expect(PopoverDescription).toBe(BasePopover.Description)
    })
  })
})
