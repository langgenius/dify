import * as React from 'react'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import {
  Autocomplete,
  AutocompleteClear,
  AutocompleteEmpty,
  AutocompleteGroup,
  AutocompleteGroupLabel,
  AutocompleteInput,
  AutocompleteInputGroup,
  AutocompleteItem,
  AutocompleteItemIndicator,
  AutocompleteItemText,
  AutocompleteList,
  AutocompletePopup,
  AutocompletePortal,
  AutocompletePositioner,
  AutocompleteSeparator,
  AutocompleteStatus,
  AutocompleteTrigger,
} from '../index'

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

    it('should set input defaults and forward passthrough props', async () => {
      const screen = await renderAutocomplete({
        children: (
          <AutocompleteInputGroup>
            <AutocompleteInput
              aria-label="Search suggestions"
              className="custom-input"
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
      await expect
        .element(screen.getByRole('combobox', { name: 'Search suggestions' }))
        .toHaveClass('custom-input')
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

    it('should forward custom classes to label separator item text and indicator', async () => {
      const screen = await renderWithSafeViewport(
        <Autocomplete open defaultValue="workflow" items={['workflow']}>
          <AutocompleteInputGroup>
            <AutocompleteInput aria-label="Search suggestions" />
          </AutocompleteInputGroup>
          <AutocompletePortal>
            <AutocompletePositioner>
              <AutocompletePopup role="dialog" aria-label="autocomplete popup">
                <AutocompleteList role="listbox" aria-label="autocomplete list">
                  <AutocompleteGroup items={['workflow']}>
                    <AutocompleteGroupLabel className="custom-label">
                      Resources
                    </AutocompleteGroupLabel>
                    <AutocompleteSeparator className="custom-separator" data-testid="separator" />
                    <AutocompleteItem value="workflow" className="custom-item">
                      <AutocompleteItemText className="custom-text">Workflow</AutocompleteItemText>
                      <AutocompleteItemIndicator
                        className="custom-indicator"
                        data-testid="indicator"
                      />
                    </AutocompleteItem>
                  </AutocompleteGroup>
                </AutocompleteList>
              </AutocompletePopup>
            </AutocompletePositioner>
          </AutocompletePortal>
        </Autocomplete>,
      )

      await expect.element(screen.getByText('Resources')).toHaveClass('custom-label')
      await expect.element(screen.getByTestId('separator')).toHaveClass('custom-separator')
      await expect
        .element(screen.getByRole('option', { name: 'Workflow' }))
        .toHaveClass('custom-item')
      await expect.element(screen.getByText('Workflow')).toHaveClass('custom-text')
      await expect.element(screen.getByTestId('indicator')).toHaveClass('custom-indicator')
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
