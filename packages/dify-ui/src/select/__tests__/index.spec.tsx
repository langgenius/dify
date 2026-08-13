import * as React from 'react'
import { page } from 'vite-plus/test/browser'
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

const renderWithSafeViewport = (ui: React.ReactNode) =>
  render(<div style={{ minHeight: '100vh', minWidth: '100vw', padding: '240px' }}>{ui}</div>)

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
      <SelectContent {...contentProps}>
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
            <SelectContent>
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

    it('should expose a controlled null value to a typed multiple value renderer', async () => {
      const screen = await renderWithSafeViewport(
        <Select<string, true> multiple value={null}>
          <SelectTrigger aria-label="city select">
            <SelectValue<string, true>>
              {(selectedValue) =>
                selectedValue === null ? 'No cities selected' : selectedValue.join(', ')
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem<string> value="seattle">
              <SelectItemText>Seattle</SelectItemText>
            </SelectItem>
          </SelectContent>
        </Select>,
      )

      await expect.element(screen.getByText('No cities selected')).toBeInTheDocument()
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
          disabled: true,
        },
      })

      await expect.element(screen.getByRole('combobox', { name: 'Choose option' })).toBeDisabled()
    })

    it('should expose disabled state via data attributes when disabled', async () => {
      const screen = await renderOpenSelect({
        triggerProps: { disabled: true },
      })

      await expect
        .element(screen.getByRole('combobox', { name: 'city select' }))
        .toHaveAttribute('data-disabled')
    })

    it('should expose readonly state via data attributes when Root is readOnly', async () => {
      const screen = await renderOpenSelect({
        rootProps: { readOnly: true },
      })

      await expect
        .element(screen.getByRole('combobox', { name: 'city select' }))
        .toHaveAttribute('data-readonly')
    })
  })

  describe('SelectContent', () => {
    it('should keep long options inside a narrow viewport', async () => {
      const popupRef = React.createRef<HTMLDivElement>()
      const originalViewport = {
        height: window.innerHeight,
        width: window.innerWidth,
      }

      await page.viewport(320, 568)

      try {
        const screen = await render(
          <div style={{ width: '100vw' }}>
            <Select open defaultValue="english">
              <SelectTrigger aria-label="deployment target">
                <SelectValue />
              </SelectTrigger>
              <SelectContent popupProps={{ ref: popupRef }}>
                <SelectItem value="english">
                  <SelectItemText>
                    Production deployment with a long provider and region identifier
                  </SelectItemText>
                </SelectItem>
                <SelectItem value="chinese">
                  <SelectItemText>生产环境中的超长模型服务供应商和区域标识名称</SelectItemText>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>,
        )

        await expect.element(screen.getByRole('listbox')).toBeVisible()
        await vi.waitFor(() => {
          const viewportWidth = document.documentElement.clientWidth
          const popupBounds = popupRef.current?.getBoundingClientRect()

          expect(popupBounds).toBeDefined()
          expect(viewportWidth).toBe(320)
          expect(popupBounds?.left).toBeGreaterThanOrEqual(0)
          expect(popupBounds?.right).toBeLessThanOrEqual(viewportWidth)
          expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(viewportWidth)
        })
      } finally {
        await page.viewport(originalViewport.width, originalViewport.height)
      }
    })

    it('should preserve an explicit popup width when the viewport has enough space', async () => {
      const popupRef = React.createRef<HTMLDivElement>()
      const originalViewport = {
        height: window.innerHeight,
        width: window.innerWidth,
      }

      await page.viewport(800, 600)

      try {
        const screen = await render(
          <div style={{ width: '256px' }}>
            <Select open defaultValue="stable">
              <SelectTrigger aria-label="package version">
                <SelectValue />
              </SelectTrigger>
              <SelectContent popupClassName="w-[512px]" popupProps={{ ref: popupRef }}>
                <SelectItem value="stable">
                  <SelectItemText>Stable package version</SelectItemText>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>,
        )

        await expect.element(screen.getByRole('listbox')).toBeVisible()
        await vi.waitFor(() => {
          expect(popupRef.current?.getBoundingClientRect().width).toBe(512)
        })
      } finally {
        await page.viewport(originalViewport.width, originalViewport.height)
      }
    })

    it('should render SelectGroupLabel for grouped options without naming the trigger', async () => {
      const screen = await renderWithSafeViewport(
        <Select open defaultValue="seattle">
          <SelectTrigger aria-label="city select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
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

      await expect
        .element(screen.getByRole('combobox', { name: 'city select' }))
        .toBeInTheDocument()
      await expect.element(screen.getByText('Popular cities')).toHaveClass('custom-label')
    })

    it('should use positioning attributes when placement is not provided', async () => {
      const positionerRef = React.createRef<HTMLDivElement>()

      await renderOpenSelect({
        contentProps: {
          positionerProps: { ref: positionerRef },
        },
      })

      await vi.waitFor(() => {
        expect(positionerRef.current).toHaveAttribute('data-side', 'bottom')
        expect(positionerRef.current).toHaveAttribute('data-align', 'start')
      })
    })

    it('should preserve positioning attributes when placement props are provided', async () => {
      const positionerRef = React.createRef<HTMLDivElement>()

      await renderOpenSelect({
        contentProps: {
          placement: 'top-end',
          sideOffset: 12,
          alignOffset: 6,
          positionerProps: { ref: positionerRef },
        },
      })

      await vi.waitFor(() => {
        expect(positionerRef.current).toHaveAttribute('data-side', 'top')
        expect(positionerRef.current).toHaveAttribute('data-align', 'end')
      })
    })

    it('should forward passthrough props to positioner popup and list when passthrough props are provided', async () => {
      const onPopupClick = vi.fn()
      const onListFocus = vi.fn()
      const positionerRef = React.createRef<HTMLDivElement>()
      const popupRef = React.createRef<HTMLDivElement>()
      const listRef = React.createRef<HTMLDivElement>()

      const screen = await render(
        <Select open defaultValue="seattle">
          <SelectTrigger aria-label="city select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent
            positionerProps={{
              id: 'select-positioner',
              ref: positionerRef,
            }}
            popupProps={{
              id: 'select-popup',
              ref: popupRef,
              onClick: onPopupClick,
            }}
            listProps={{
              'aria-label': 'select list',
              id: 'select-list',
              ref: listRef,
              onFocus: onListFocus,
            }}
          >
            <SelectItem value="seattle">
              <SelectItemText>Seattle</SelectItemText>
              <SelectItemIndicator />
            </SelectItem>
          </SelectContent>
        </Select>,
      )

      popupRef.current?.click()
      listRef.current?.dispatchEvent(
        new FocusEvent('focusin', {
          bubbles: true,
        }),
      )

      expect(positionerRef.current).toHaveAttribute('id', 'select-positioner')
      expect(popupRef.current).toHaveAttribute('id', 'select-popup')
      await expect
        .element(screen.getByRole('listbox', { name: 'select list' }))
        .toHaveAttribute('id', 'select-list')
      expect(onPopupClick).toHaveBeenCalledTimes(1)
      expect(onListFocus).toHaveBeenCalled()
    })
  })

  describe('SelectItem', () => {
    it('should expose disabled item semantics', async () => {
      const screen = await render(
        <Select open defaultValue="seattle">
          <SelectTrigger aria-label="city select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
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

      await expect
        .element(screen.getByRole('option', { name: 'Disabled New York' }))
        .toHaveAttribute('aria-disabled', 'true')
    })

    it('should support custom composition with SelectItemText without indicator', async () => {
      const screen = await render(
        <Select open defaultValue="a">
          <SelectTrigger aria-label="custom select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
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
