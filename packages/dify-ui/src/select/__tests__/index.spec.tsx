import { render } from 'vitest-browser-react'
import { Select, SelectContent, SelectItem, SelectItemIndicator, SelectItemText, SelectTrigger, SelectValue } from '../index'

const asHTMLElement = (element: HTMLElement | SVGElement) => element as HTMLElement
const renderWithSafeViewport = (ui: import('react').ReactNode) => render(
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
    it('should forward native trigger props when trigger props are provided', async () => {
      const screen = await renderOpenSelect({
        triggerProps: {
          'aria-label': 'Choose option',
          'disabled': true,
        },
      })

      await expect.element(screen.getByRole('combobox', { name: 'Choose option' })).toBeDisabled()
    })

    it('should apply regular size variant classes by default', async () => {
      const screen = await renderOpenSelect()

      expect(screen.getByRole('combobox', { name: 'city select' }).element().className).toMatch(/system-sm-regular/)
      expect(screen.getByRole('combobox', { name: 'city select' }).element().className).toMatch(/rounded-lg/)
    })

    it('should apply small size variant classes when size is small', async () => {
      const screen = await renderOpenSelect({
        triggerProps: { size: 'small' },
      })

      expect(screen.getByRole('combobox', { name: 'city select' }).element().className).toMatch(/system-xs-regular/)
      expect(screen.getByRole('combobox', { name: 'city select' }).element().className).toMatch(/rounded-md/)
    })

    it('should apply large size variant classes when size is large', async () => {
      const screen = await renderOpenSelect({
        triggerProps: { size: 'large' },
      })

      expect(screen.getByRole('combobox', { name: 'city select' }).element().className).toMatch(/system-md-regular/)
    })

    it('should apply disabled styling via data attributes when disabled', async () => {
      const screen = await renderOpenSelect({
        triggerProps: { disabled: true },
      })

      await expect.element(screen.getByRole('combobox', { name: 'city select' })).toHaveAttribute('data-disabled')
      expect(screen.getByRole('combobox', { name: 'city select' }).element().className).toContain('data-disabled:bg-components-input-bg-disabled')
    })

    it('should apply disabled placeholder color class for compound state', async () => {
      const screen = await renderOpenSelect({
        triggerProps: { disabled: true },
      })

      expect(screen.getByRole('combobox', { name: 'city select' }).element().className).toContain('data-disabled:data-placeholder:text-components-input-text-disabled')
    })

    it('should apply readonly styling via data attributes when Root is readOnly', async () => {
      const screen = await renderOpenSelect({
        rootProps: { readOnly: true },
      })

      await expect.element(screen.getByRole('combobox', { name: 'city select' })).toHaveAttribute('data-readonly')
      expect(screen.getByRole('combobox', { name: 'city select' }).element().className).toContain('data-readonly:bg-transparent')
    })

    it('should hide arrow icon via CSS when Root is readOnly', async () => {
      const screen = await renderOpenSelect({
        rootProps: { readOnly: true },
      })

      expect(screen.getByRole('combobox', { name: 'city select' }).element().querySelector('[class*="group-data-readonly:hidden"]')).toBeInTheDocument()
    })

    it('should set aria-hidden on decorative icons', async () => {
      const screen = await renderOpenSelect()

      expect(screen.getByRole('combobox', { name: 'city select' }).element().querySelector('.i-ri-arrow-down-s-line')).toHaveAttribute('aria-hidden', 'true')
    })

    it('should include placeholder color class via data attribute', async () => {
      const screen = await renderOpenSelect()

      expect(screen.getByRole('combobox', { name: 'city select' }).element().className).toContain('data-placeholder:text-components-input-text-placeholder')
    })

    it('should render built-in chevron icon', async () => {
      const screen = await renderOpenSelect()

      expect(screen.getByRole('combobox', { name: 'city select' }).element().querySelector('.i-ri-arrow-down-s-line')).toBeInTheDocument()
    })

    it('should include open state feedback classes', async () => {
      const screen = await renderOpenSelect()

      expect(screen.getByRole('combobox', { name: 'city select' }).element().className).toContain('data-open:bg-state-base-hover-alt')
    })
  })

  describe('SelectContent', () => {
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
