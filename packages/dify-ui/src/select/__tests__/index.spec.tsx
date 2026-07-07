import type * as React from 'react'
import { render } from 'vitest-browser-react'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '../index'

const asHTMLElement = (element: HTMLElement | SVGElement) => element as HTMLElement
const renderWithSafeViewport = (ui: React.ReactNode) => render(
  <div style={{ minHeight: '100vh', minWidth: '100vw', padding: '240px' }}>
    {ui}
  </div>,
)

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
  return renderWithSafeViewport(
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
    it('should submit the hidden input value and preserve autocomplete hints inside a form', async () => {
      const screen = await render(
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

      const hiddenInput = screen.container.querySelector('input[name="city"]')
      const form = screen.getByRole('form', { name: 'profile form' }).element() as HTMLFormElement

      expect(hiddenInput).toHaveAttribute('autocomplete', 'address-level2')
      expect(new FormData(form).get('city')).toBe('seattle')
    })
  })

  describe('SelectTrigger', () => {
    it('should use SelectLabel as the trigger accessible name', async () => {
      const screen = await renderWithSafeViewport(
        <Select defaultValue="seattle">
          <SelectLabel>City</SelectLabel>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="seattle">
              <SelectItemText>Seattle</SelectItemText>
              <SelectItemIndicator />
            </SelectItem>
          </SelectContent>
        </Select>,
      )

      await expect.element(screen.getByRole('combobox', { name: 'City' })).toBeInTheDocument()
    })

    it('should forward native trigger props when trigger props are provided', async () => {
      const screen = await renderOpenSelect({
        triggerProps: {
          'aria-label': 'Choose option',
          'disabled': true,
        },
      })

      await expect.element(screen.getByRole('combobox', { name: 'Choose option' })).toBeDisabled()
    })

    it('should expose disabled state via data attributes when disabled', async () => {
      const screen = await renderOpenSelect({
        triggerProps: { disabled: true },
      })

      await expect.element(screen.getByRole('combobox', { name: 'city select' })).toHaveAttribute('data-disabled')
    })

    it('should expose readonly state via data attributes when Root is readOnly', async () => {
      const screen = await renderOpenSelect({
        rootProps: { readOnly: true },
      })

      await expect.element(screen.getByRole('combobox', { name: 'city select' })).toHaveAttribute('data-readonly')
    })
  })

  describe('SelectContent', () => {
    it('should render SelectGroupLabel for grouped options without naming the trigger', async () => {
      const screen = await renderWithSafeViewport(
        <Select open defaultValue="seattle">
          <SelectTrigger aria-label="city select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent listProps={{ 'role': 'listbox', 'aria-label': 'select list' }}>
            <SelectGroup>
              <SelectGroupLabel className="custom-label">Popular cities</SelectGroupLabel>
              <SelectItem value="seattle">
                <SelectItemText>Seattle</SelectItemText>
                <SelectItemIndicator />
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>,
      )

      await expect.element(screen.getByRole('combobox', { name: 'city select' })).toBeInTheDocument()
      await expect.element(screen.getByText('Popular cities')).toHaveClass('custom-label')
    })

    it('should use positioning attributes when placement is not provided', async () => {
      const screen = await renderOpenSelect()

      await expect.element(screen.getByRole('group', { name: 'select positioner' })).toHaveAttribute('data-side', 'bottom')
      await expect.element(screen.getByRole('group', { name: 'select positioner' })).toHaveAttribute('data-align', 'start')
    })

    it('should preserve positioning attributes when placement props are provided', async () => {
      const screen = await renderOpenSelect({
        contentProps: {
          placement: 'top-end',
          sideOffset: 12,
          alignOffset: 6,
        },
      })

      await expect.element(screen.getByRole('group', { name: 'select positioner' })).toHaveAttribute('data-side', 'top')
      await expect.element(screen.getByRole('group', { name: 'select positioner' })).toHaveAttribute('data-align', 'end')
    })

    it('should forward passthrough props to positioner popup and list when passthrough props are provided', async () => {
      const onPopupClick = vi.fn()
      const onListFocus = vi.fn()

      const screen = await render(
        <Select open defaultValue="seattle">
          <SelectTrigger aria-label="city select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent
            positionerProps={{
              'role': 'group',
              'aria-label': 'select positioner',
              'id': 'select-positioner',
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

      await screen.getByRole('dialog', { name: 'select popup' }).click()
      screen.getByRole('listbox', { name: 'select list' }).element().dispatchEvent(new FocusEvent('focusin', {
        bubbles: true,
      }))

      await expect.element(screen.getByRole('group', { name: 'select positioner' })).toHaveAttribute('id', 'select-positioner')
      await expect.element(screen.getByRole('dialog', { name: 'select popup' })).toHaveAttribute('id', 'select-popup')
      await expect.element(screen.getByRole('listbox', { name: 'select list' })).toHaveAttribute('id', 'select-list')
      expect(onPopupClick).toHaveBeenCalledTimes(1)
      expect(onListFocus).toHaveBeenCalled()
    })
  })

  describe('SelectItem', () => {
    it('should render options when children are provided', async () => {
      const screen = await renderOpenSelect()

      await expect.element(screen.getByRole('option', { name: 'Seattle' })).toBeInTheDocument()
      await expect.element(screen.getByRole('option', { name: 'New York' })).toBeInTheDocument()
    })

    it('should navigate items with arrow keys', async () => {
      const screen = await render(
        <Select defaultValue="seattle">
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
            <SelectItem value="tokyo">
              <SelectItemText>Tokyo</SelectItemText>
              <SelectItemIndicator />
            </SelectItem>
          </SelectContent>
        </Select>,
      )

      const trigger = asHTMLElement(screen.getByRole('combobox', { name: 'city select' }).element())

      trigger.focus()
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
      await expect.element(screen.getByRole('option', { name: 'Seattle' })).toHaveAttribute('data-highlighted')

      const highlightedItem = asHTMLElement(screen.getByRole('option', { name: 'Seattle' }).element())
      highlightedItem.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))

      await expect.element(screen.getByRole('option', { name: 'New York' })).toHaveAttribute('data-highlighted')
    })

    it('should not call onValueChange when disabled item is clicked', async () => {
      const onValueChange = vi.fn()

      const screen = await render(
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

      asHTMLElement(screen.getByRole('option', { name: 'Disabled New York' }).element()).click()

      expect(onValueChange).not.toHaveBeenCalled()
    })

    it('should support custom composition with SelectItemText without indicator', async () => {
      const screen = await render(
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

      await expect.element(screen.getByRole('option', { name: 'Custom Item' })).toBeInTheDocument()
    })
  })
})
