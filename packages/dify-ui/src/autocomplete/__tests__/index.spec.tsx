import * as React from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import {
  Autocomplete,
  AutocompleteClear,
  AutocompleteEmpty,
  AutocompleteInput,
  AutocompleteInputGroup,
  AutocompleteItem,
  AutocompleteItemIndicator,
  AutocompleteItemText,
  AutocompleteList,
  AutocompletePopup,
  AutocompletePortal,
  AutocompletePositioner,
  AutocompleteStatus,
  AutocompleteTrigger,
  useAutocompleteFilteredItems,
} from '../index'

function AutocompleteTypeExamples() {
  const filteredItems = useAutocompleteFilteredItems<string>()

  // @ts-expect-error internally filtered items are read-only
  filteredItems.push('workflow')

  return null
}

void AutocompleteTypeExamples

const renderWithSafeViewport = (ui: React.ReactNode) =>
  render(<div style={{ minHeight: '100vh', minWidth: '100vw', padding: '240px' }}>{ui}</div>)

const asHTMLElement = (element: HTMLElement | SVGElement) => element as HTMLElement

const renderAutocomplete = ({
  children,
  open = false,
  defaultValue = 'workflow',
}: {
  children?: React.ReactNode
  open?: boolean
  defaultValue?: string
} = {}) =>
  renderWithSafeViewport(
    <Autocomplete open={open} defaultValue={defaultValue} items={['workflow', 'dataset']}>
      {children ?? (
        <React.Fragment>
          <AutocompleteInputGroup data-testid="input-group">
            <AutocompleteInput aria-label="Search suggestions" data-testid="input" />
            <AutocompleteClear data-testid="clear" />
            <AutocompleteTrigger data-testid="trigger" />
          </AutocompleteInputGroup>
          <AutocompletePortal>
            <AutocompletePositioner role="group" aria-label="autocomplete positioner">
              <AutocompletePopup role="dialog" aria-label="autocomplete popup">
                <AutocompleteStatus data-testid="status">2 suggestions</AutocompleteStatus>
                <AutocompleteList role="listbox" aria-label="autocomplete list" data-testid="list">
                  <AutocompleteItem value="workflow">
                    <AutocompleteItemText>Workflow</AutocompleteItemText>
                    <AutocompleteItemIndicator />
                  </AutocompleteItem>
                  <AutocompleteItem value="dataset">
                    <AutocompleteItemText>Dataset</AutocompleteItemText>
                  </AutocompleteItem>
                </AutocompleteList>
                <AutocompleteEmpty data-testid="empty">No suggestions</AutocompleteEmpty>
              </AutocompletePopup>
            </AutocompletePositioner>
          </AutocompletePortal>
        </React.Fragment>
      )}
    </Autocomplete>,
  )

describe('Autocomplete wrappers', () => {
  describe('Input group and input', () => {
    it('should show the compound focus surface when keyboard users enter without Field', async () => {
      const screen = await renderAutocomplete()
      const inputGroup = screen.getByTestId('input-group')
      const input = screen.getByTestId('input')
      const restingBoxShadow = getComputedStyle(inputGroup.element()).boxShadow

      await userEvent.keyboard('{Tab}')

      await expect.element(input).toHaveFocus()
      await expect
        .poll(() => getComputedStyle(inputGroup.element()).boxShadow)
        .not.toBe(restingBoxShadow)
    })

    it('should disable autocomplete and expose placeholder and required state', async () => {
      const screen = await renderAutocomplete({
        children: (
          <AutocompleteInputGroup>
            <AutocompleteInput
              aria-label="Search suggestions"

              placeholder="Find a resource"
              required
            />
          </AutocompleteInputGroup>
        ),
      })

      await expect
        .element(screen.getByRole('combobox', { name: 'Search suggestions' }))
        .toHaveAttribute('autocomplete', 'off')
      await expect
        .element(screen.getByRole('combobox', { name: 'Search suggestions' }))
        .toHaveAttribute('placeholder', 'Find a resource')
      await expect
        .element(screen.getByRole('combobox', { name: 'Search suggestions' }))
        .toBeRequired()
    })

    it('should not inject input-only attributes into a custom textarea', async () => {
      const screen = await renderAutocomplete({
        children: (
          <AutocompleteInputGroup>
            <AutocompleteInput aria-label="Search suggestions" render={<textarea />} />
          </AutocompleteInputGroup>
        ),
      })

      await expect.element(screen.getByLabelText('Search suggestions')).not.toHaveAttribute('type')
    })
  })

  describe('Controls', () => {
    it('should provide fallback aria labels and decorative icons when labels are omitted', async () => {
      const screen = await renderAutocomplete()

      await expect
        .element(screen.getByRole('button', { name: 'Clear autocomplete' }))
        .toHaveAttribute('type', 'button')
      await expect
        .element(screen.getByRole('button', { name: 'Open autocomplete suggestions' }))
        .toHaveAttribute('type', 'button')
    })

    it('should preserve explicit labels and custom children', async () => {
      const screen = await renderAutocomplete({
        children: (
          <AutocompleteInputGroup>
            <AutocompleteInput aria-label="Search suggestions" />
            <AutocompleteClear aria-label="Reset search">
              <span data-testid="custom-clear">reset</span>
            </AutocompleteClear>
            <AutocompleteTrigger aria-label="Show suggestions">
              <span data-testid="custom-trigger">open</span>
            </AutocompleteTrigger>
          </AutocompleteInputGroup>
        ),
      })

      expect(screen.getByRole('button', { name: 'Reset search' }).element()).toContainElement(
        screen.getByTestId('custom-clear').element(),
      )
      expect(screen.getByRole('button', { name: 'Show suggestions' }).element()).toContainElement(
        screen.getByTestId('custom-trigger').element(),
      )
    })

    it('should rely on aria-labelledby when provided instead of injecting fallback labels', async () => {
      const screen = await renderAutocomplete({
        children: (
          <React.Fragment>
            <span id="clear-label">Clear from label</span>
            <span id="trigger-label">Trigger from label</span>
            <AutocompleteInputGroup>
              <AutocompleteInput aria-label="Search suggestions" />
              <AutocompleteClear aria-labelledby="clear-label" />
              <AutocompleteTrigger aria-labelledby="trigger-label" />
            </AutocompleteInputGroup>
          </React.Fragment>
        ),
      })

      await expect
        .element(screen.getByRole('button', { name: 'Clear from label' }))
        .not.toHaveAttribute('aria-label')
      await expect
        .element(screen.getByRole('button', { name: 'Trigger from label' }))
        .not.toHaveAttribute('aria-label')
    })
  })

  describe('Content and options', () => {
    it('should keep the status visible and scroll the list in a short viewport', async () => {
      const popupRef = React.createRef<HTMLDivElement>()
      const longOptions = Array.from({ length: 30 }, (_, index) => `Suggestion ${index + 1}`)
      const originalViewport = {
        height: window.innerHeight,
        width: window.innerWidth,
      }

      await page.viewport(800, 360)

      try {
        const screen = await render(
          <div style={{ padding: 16 }}>
            <Autocomplete open items={longOptions}>
              <AutocompleteInputGroup>
                <AutocompleteInput aria-label="Search" />
              </AutocompleteInputGroup>
              <AutocompletePortal>
                <AutocompletePositioner>
                  <AutocompletePopup ref={popupRef}>
                    <AutocompleteStatus>30 suggestions</AutocompleteStatus>
                    <AutocompleteList<string>>
                      {(item) => (
                        <AutocompleteItem key={item} value={item}>
                          {item}
                        </AutocompleteItem>
                      )}
                    </AutocompleteList>
                  </AutocompletePopup>
                </AutocompletePositioner>
              </AutocompletePortal>
            </Autocomplete>
          </div>,
        )

        const status = screen.getByText('30 suggestions')
        const list = screen.getByRole('listbox')
        await expect.element(list).toBeVisible()
        await vi.waitFor(() => {
          const popupBounds = popupRef.current!.getBoundingClientRect()
          const statusBounds = status.element().getBoundingClientRect()

          expect(window.innerHeight).toBe(360)
          expect(popupBounds.top).toBeGreaterThanOrEqual(0)
          expect(popupBounds.bottom).toBeLessThanOrEqual(window.innerHeight)
          expect(statusBounds.top).toBeGreaterThanOrEqual(popupBounds.top)
          expect(statusBounds.bottom).toBeLessThanOrEqual(popupBounds.bottom)
          expect(list.element().scrollHeight).toBeGreaterThan(list.element().clientHeight)
          expect(popupRef.current!.scrollHeight).toBeLessThanOrEqual(popupRef.current!.clientHeight)
        })
      } finally {
        await page.viewport(originalViewport.width, originalViewport.height)
      }
    })

    it('should use default overlay placement', async () => {
      const screen = await renderAutocomplete({ open: true })

      await expect
        .element(screen.getByRole('group', { name: 'autocomplete positioner' }))
        .toHaveAttribute('data-side', 'bottom')
      await expect
        .element(screen.getByRole('group', { name: 'autocomplete positioner' }))
        .toHaveAttribute('data-align', 'start')
    })

    it('should apply custom placement and popup props to their owning parts', async () => {
      const onPopupClick = vi.fn()
      const screen = await renderWithSafeViewport(
        <Autocomplete open defaultValue="workflow" items={['workflow']}>
          <AutocompleteInputGroup>
            <AutocompleteInput aria-label="Search suggestions" />
          </AutocompleteInputGroup>
          <AutocompletePortal>
            <AutocompletePositioner
              placement="top-end"
              sideOffset={12}
              alignOffset={6}
              role="group"
              aria-label="autocomplete positioner"
            >
              <AutocompletePopup
                role="dialog"
                aria-label="autocomplete popup"
                onClick={onPopupClick}
              >
                <AutocompleteList role="listbox" aria-label="autocomplete list">
                  <AutocompleteItem value="workflow">
                    <AutocompleteItemText>Workflow</AutocompleteItemText>
                  </AutocompleteItem>
                </AutocompleteList>
              </AutocompletePopup>
            </AutocompletePositioner>
          </AutocompletePortal>
        </Autocomplete>,
      )

      await screen.getByRole('dialog', { name: 'autocomplete popup' }).click()

      await expect
        .element(screen.getByRole('group', { name: 'autocomplete positioner' }))
        .toHaveAttribute('data-side', 'top')
      expect(onPopupClick).toHaveBeenCalledTimes(1)
    })

    it('should navigate function-rendered items with arrow keys', async () => {
      const screen = await renderWithSafeViewport(
        <Autocomplete open defaultValue="" items={['workflow', 'dataset', 'app']}>
          <AutocompleteInputGroup>
            <AutocompleteInput aria-label="Search resources" />
          </AutocompleteInputGroup>
          <AutocompletePortal>
            <AutocompletePositioner>
              <AutocompletePopup>
                <AutocompleteList<string>>
                  {(item) => (
                    <AutocompleteItem key={item} value={item}>
                      <AutocompleteItemText>{item}</AutocompleteItemText>
                    </AutocompleteItem>
                  )}
                </AutocompleteList>
              </AutocompletePopup>
            </AutocompletePositioner>
          </AutocompletePortal>
        </Autocomplete>,
      )

      const input = asHTMLElement(
        screen.getByRole('combobox', { name: 'Search resources' }).element(),
      )

      input.focus()
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
      )
      await expect
        .element(screen.getByRole('option', { name: 'workflow' }))
        .toHaveAttribute('data-highlighted')

      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
      )

      await expect
        .element(screen.getByRole('option', { name: 'dataset' }))
        .toHaveAttribute('data-highlighted')
    })
  })
})
