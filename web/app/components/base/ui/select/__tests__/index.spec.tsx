import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../index'

const renderOpenSelect = ({
  triggerProps = {},
  contentProps = {},
  onValueChange,
}: {
  triggerProps?: Record<string, unknown>
  contentProps?: Record<string, unknown>
  onValueChange?: (value: string | null) => void
} = {}) => {
  return render(
    <Select open defaultValue="seattle" onValueChange={onValueChange}>
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
        <SelectItem value="seattle">Seattle</SelectItem>
        <SelectItem value="new-york">New York</SelectItem>
      </SelectContent>
    </Select>,
  )
}

describe('Select wrappers', () => {
  describe('SelectTrigger', () => {
    it('should render clear button when clearable is true and loading is false', () => {
      renderOpenSelect({
        triggerProps: { clearable: true },
      })

      expect(screen.getByRole('button', { name: /clear selection/i })).toBeInTheDocument()
    })

    it('should hide clear button when loading is true', () => {
      renderOpenSelect({
        triggerProps: { clearable: true, loading: true },
      })

      expect(screen.queryByRole('button', { name: /clear selection/i })).not.toBeInTheDocument()
    })

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

    it('should call onClear and stop click propagation when clear button is clicked', () => {
      const onClear = vi.fn()
      const onTriggerClick = vi.fn()

      renderOpenSelect({
        triggerProps: {
          clearable: true,
          onClear,
          onClick: onTriggerClick,
        },
      })

      fireEvent.click(screen.getByRole('button', { name: /clear selection/i }))

      expect(onClear).toHaveBeenCalledTimes(1)
      expect(onTriggerClick).not.toHaveBeenCalled()
    })

    it('should stop mouse down propagation when clear button receives mouse down', () => {
      const onTriggerMouseDown = vi.fn()

      renderOpenSelect({
        triggerProps: {
          clearable: true,
          onMouseDown: onTriggerMouseDown,
        },
      })

      fireEvent.mouseDown(screen.getByRole('button', { name: /clear selection/i }))

      expect(onTriggerMouseDown).not.toHaveBeenCalled()
    })

    it('should not throw when clear button is clicked without onClear handler', () => {
      renderOpenSelect({
        triggerProps: { clearable: true },
      })

      const clearButton = screen.getByRole('button', { name: /clear selection/i })
      expect(() => fireEvent.click(clearButton)).not.toThrow()
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
            <SelectItem value="seattle">Seattle</SelectItem>
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
            <SelectItem value="seattle">Seattle</SelectItem>
            <SelectItem value="new-york" disabled aria-label="Disabled New York">
              New York
            </SelectItem>
          </SelectContent>
        </Select>,
      )

      fireEvent.click(screen.getByRole('option', { name: 'Disabled New York' }))

      expect(onValueChange).not.toHaveBeenCalled()
    })
  })
})
