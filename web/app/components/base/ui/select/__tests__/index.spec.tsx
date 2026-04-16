import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Select, SelectContent, SelectItem, SelectItemIndicator, SelectItemText, SelectTrigger, SelectValue } from '../index'

const renderOpenSelect = ({
  rootProps = {},
  triggerProps = {},
  contentProps = {},
  onValueChange,
}: {
  rootProps?: Record<string, unknown>
  triggerProps?: Record<string, unknown>
  contentProps?: Record<string, unknown>
  onValueChange?: (value: string | null) => void
} = {}) => {
  return render(
    <Select open defaultValue="seattle" onValueChange={onValueChange} {...rootProps}>
      <SelectTrigger aria-label="city select" {...triggerProps}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent
        positionerProps={{
          'role': 'group',
          'aria-label': 'select positioner',
        }}
        popupProps={{
          'role': 'dialog',
          'aria-label': 'select popup',
        }}
        listProps={{
          'role': 'listbox',
          'aria-label': 'select list',
        }}
        {...contentProps}
      >
        <SelectItem value="seattle">
          <SelectItemText>Seattle</SelectItemText>
          <SelectItemIndicator />
        </SelectItem>
        <SelectItem value="new-york">
          <SelectItemText>New York</SelectItemText>
          <SelectItemIndicator />
        </SelectItem>
      </SelectContent>
    </Select>,
  )
}

describe('Select wrappers', () => {
  describe('Select root integration', () => {
    it('should submit the hidden input value and preserve autocomplete hints inside a form', () => {
      const { container } = render(
        <form aria-label="profile form">
          <Select defaultValue="seattle" name="city" autoComplete="address-level2">
            <SelectTrigger aria-label="city select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent listProps={{ 'role': 'listbox', 'aria-label': 'select list' }}>
              <SelectItem value="seattle">
                <SelectItemText>Seattle</SelectItemText>
                <SelectItemIndicator />
              </SelectItem>
              <SelectItem value="new-york">
                <SelectItemText>New York</SelectItemText>
                <SelectItemIndicator />
              </SelectItem>
            </SelectContent>
          </Select>
        </form>,
      )

      const hiddenInput = container.querySelector('input[name="city"]')
      const form = screen.getByRole('form', { name: 'profile form' }) as HTMLFormElement

      expect(hiddenInput).toHaveAttribute('autocomplete', 'address-level2')
      expect(new FormData(form).get('city')).toBe('seattle')
    })
  })

  describe('SelectTrigger', () => {
    it('should forward native trigger props when trigger props are provided', () => {
      renderOpenSelect({
        triggerProps: {
          'aria-label': 'Choose option',
          'disabled': true,
        },
      })

      const trigger = screen.getByRole('combobox', { name: 'Choose option' })
      expect(trigger).toBeDisabled()
    })

    it('should apply regular size variant classes by default', () => {
      renderOpenSelect()

      const trigger = screen.getByRole('combobox', { name: 'city select' })
      expect(trigger.className).toMatch(/system-sm-regular/)
      expect(trigger.className).toMatch(/rounded-lg/)
    })

    it('should apply small size variant classes when size is small', () => {
      renderOpenSelect({
        triggerProps: { size: 'small' },
      })

      const trigger = screen.getByRole('combobox', { name: 'city select' })
      expect(trigger.className).toMatch(/system-xs-regular/)
      expect(trigger.className).toMatch(/rounded-md/)
    })

    it('should apply large size variant classes when size is large', () => {
      renderOpenSelect({
        triggerProps: { size: 'large' },
      })

      const trigger = screen.getByRole('combobox', { name: 'city select' })
      expect(trigger.className).toMatch(/system-md-regular/)
    })

    it('should apply disabled styling via data attributes when disabled', () => {
      renderOpenSelect({
        triggerProps: { disabled: true },
      })

      const trigger = screen.getByRole('combobox', { name: 'city select' })
      expect(trigger).toHaveAttribute('data-disabled')
      expect(trigger.className).toContain('data-disabled:bg-components-input-bg-disabled')
    })

    it('should apply disabled placeholder color class for compound state', () => {
      renderOpenSelect({
        triggerProps: { disabled: true },
      })

      const trigger = screen.getByRole('combobox', { name: 'city select' })
      expect(trigger.className).toContain('data-disabled:data-placeholder:text-components-input-text-disabled')
    })

    it('should apply readonly styling via data attributes when Root is readOnly', () => {
      renderOpenSelect({
        rootProps: { readOnly: true },
      })

      const trigger = screen.getByRole('combobox', { name: 'city select' })
      expect(trigger).toHaveAttribute('data-readonly')
      expect(trigger.className).toContain('data-readonly:bg-transparent')
    })

    it('should hide arrow icon via CSS when Root is readOnly', () => {
      renderOpenSelect({
        rootProps: { readOnly: true },
      })

      const trigger = screen.getByRole('combobox', { name: 'city select' })
      const iconWrapper = trigger.querySelector('[class*="group-data-readonly:hidden"]')
      expect(iconWrapper).toBeInTheDocument()
    })

    it('should set aria-hidden on decorative icons', () => {
      renderOpenSelect()

      const trigger = screen.getByRole('combobox', { name: 'city select' })
      const arrowIcon = trigger.querySelector('.i-ri-arrow-down-s-line')
      expect(arrowIcon).toHaveAttribute('aria-hidden', 'true')
    })

    it('should include placeholder color class via data attribute', () => {
      renderOpenSelect()

      const trigger = screen.getByRole('combobox', { name: 'city select' })
      expect(trigger.className).toContain('data-placeholder:text-components-input-text-placeholder')
    })

    it('should render built-in chevron icon', () => {
      renderOpenSelect()

      const trigger = screen.getByRole('combobox', { name: 'city select' })
      const chevron = trigger.querySelector('.i-ri-arrow-down-s-line')
      expect(chevron).toBeInTheDocument()
    })
  })

  describe('SelectContent', () => {
    it('should use default placement when placement is not provided', () => {
      renderOpenSelect()

      const positioner = screen.getByRole('group', { name: 'select positioner' })
      expect(positioner).toHaveAttribute('data-side', 'bottom')
      expect(positioner).toHaveAttribute('data-align', 'start')
    })

    it('should apply custom placement when placement props are provided', () => {
      renderOpenSelect({
        contentProps: {
          placement: 'top-end',
          sideOffset: 12,
          alignOffset: 6,
        },
      })

      const positioner = screen.getByRole('group', { name: 'select positioner' })
      expect(positioner).toHaveAttribute('data-side', 'top')
      expect(positioner).toHaveAttribute('data-align', 'end')
    })

    it('should forward passthrough props to positioner popup and list when passthrough props are provided', () => {
      const onPositionerMouseEnter = vi.fn()
      const onPopupClick = vi.fn()
      const onListFocus = vi.fn()

      render(
        <Select open defaultValue="seattle">
          <SelectTrigger aria-label="city select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent
            positionerProps={{
              'role': 'group',
              'aria-label': 'select positioner',
              'id': 'select-positioner',
              'onMouseEnter': onPositionerMouseEnter,
            }}
            popupProps={{
              'role': 'dialog',
              'aria-label': 'select popup',
              'id': 'select-popup',
              'onClick': onPopupClick,
            }}
            listProps={{
              'role': 'listbox',
              'aria-label': 'select list',
              'id': 'select-list',
              'onFocus': onListFocus,
            }}
          >
            <SelectItem value="seattle">
              <SelectItemText>Seattle</SelectItemText>
              <SelectItemIndicator />
            </SelectItem>
          </SelectContent>
        </Select>,
      )

      const positioner = screen.getByRole('group', { name: 'select positioner' })
      const popup = screen.getByRole('dialog', { name: 'select popup' })
      const list = screen.getByRole('listbox', { name: 'select list' })

      fireEvent.mouseEnter(positioner)
      fireEvent.click(popup)
      fireEvent.focus(list)

      expect(positioner).toHaveAttribute('id', 'select-positioner')
      expect(popup).toHaveAttribute('id', 'select-popup')
      expect(list).toHaveAttribute('id', 'select-list')
      expect(onPositionerMouseEnter).toHaveBeenCalledTimes(1)
      expect(onPopupClick).toHaveBeenCalledTimes(1)
      expect(onListFocus).toHaveBeenCalledTimes(1)
    })
  })

  describe('SelectItem', () => {
    it('should render options when children are provided', () => {
      renderOpenSelect()

      expect(screen.getByRole('option', { name: 'Seattle' })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: 'New York' })).toBeInTheDocument()
    })

    it('should not call onValueChange when disabled item is clicked', () => {
      const onValueChange = vi.fn()

      render(
        <Select open defaultValue="seattle" onValueChange={onValueChange}>
          <SelectTrigger aria-label="city select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent listProps={{ 'role': 'listbox', 'aria-label': 'select list' }}>
            <SelectItem value="seattle">
              <SelectItemText>Seattle</SelectItemText>
              <SelectItemIndicator />
            </SelectItem>
            <SelectItem value="new-york" disabled aria-label="Disabled New York">
              <SelectItemText>New York</SelectItemText>
              <SelectItemIndicator />
            </SelectItem>
          </SelectContent>
        </Select>,
      )

      fireEvent.click(screen.getByRole('option', { name: 'Disabled New York' }))

      expect(onValueChange).not.toHaveBeenCalled()
    })

    it('should support custom composition with SelectItemText without indicator', () => {
      render(
        <Select open defaultValue="a">
          <SelectTrigger aria-label="custom select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent listProps={{ 'role': 'listbox', 'aria-label': 'select list' }}>
            <SelectItem value="a" className="gap-2">
              <SelectItemText>Custom Item</SelectItemText>
            </SelectItem>
          </SelectContent>
        </Select>,
      )

      expect(screen.getByRole('option', { name: 'Custom Item' })).toBeInTheDocument()
    })
  })
})
