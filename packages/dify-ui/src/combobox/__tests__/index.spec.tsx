import * as React from 'react'
import { render } from 'vitest-browser-react'
import {
  Combobox,
  ComboboxChip,
  ComboboxChipRemove,
  ComboboxChips,
  ComboboxClear,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxInput,
  ComboboxInputGroup,
  ComboboxInputTrigger,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxItemText,
  ComboboxLabel,
  ComboboxList,
  ComboboxSeparator,
  ComboboxStatus,
  ComboboxTrigger,
  ComboboxValue,
} from '../index'

const renderWithSafeViewport = (ui: React.ReactNode) =>
  render(<div style={{ minHeight: '100vh', minWidth: '100vw', padding: '240px' }}>{ui}</div>)

const asHTMLElement = (element: HTMLElement | SVGElement) => element as HTMLElement

const renderSelectLikeCombobox = ({
  children,
  open = false,
}: {
  children?: React.ReactNode
  open?: boolean
} = {}) =>
  renderWithSafeViewport(
    <Combobox open={open} defaultValue="workflow" items={['workflow', 'dataset']}>
      {children ?? (
        <React.Fragment>
          <ComboboxLabel data-testid="label">Resource type</ComboboxLabel>
          <ComboboxTrigger aria-label="Resource type" data-testid="trigger">
            <ComboboxValue placeholder="Select resource" />
          </ComboboxTrigger>
          <ComboboxContent
            positionerProps={{
              role: 'group',
              'aria-label': 'combobox positioner',
            }}
            popupProps={{
              role: 'dialog',
              'aria-label': 'combobox popup',
            }}
          >
            <ComboboxStatus data-testid="status">2 options</ComboboxStatus>
            <ComboboxList role="listbox" aria-label="combobox list" data-testid="list">
              <ComboboxItem value="workflow">
                <ComboboxItemText>Workflow</ComboboxItemText>
                <ComboboxItemIndicator />
              </ComboboxItem>
              <ComboboxItem value="dataset">
                <ComboboxItemText>Dataset</ComboboxItemText>
              </ComboboxItem>
            </ComboboxList>
            <ComboboxEmpty data-testid="empty">No options</ComboboxEmpty>
          </ComboboxContent>
        </React.Fragment>
      )}
    </Combobox>,
  )

const renderInputCombobox = ({
  children,
  open = false,
}: {
  children?: React.ReactNode
  open?: boolean
} = {}) =>
  renderWithSafeViewport(
    <Combobox open={open} defaultValue="workflow" items={['workflow', 'dataset']}>
      {children ?? (
        <React.Fragment>
          <ComboboxInputGroup data-testid="input-group">
            <ComboboxInput aria-label="Search resources" data-testid="input" />
            <ComboboxClear data-testid="clear" />
            <ComboboxInputTrigger data-testid="input-trigger" />
          </ComboboxInputGroup>
          <ComboboxContent popupProps={{ role: 'dialog', 'aria-label': 'combobox popup' }}>
            <ComboboxList role="listbox" aria-label="combobox list">
              <ComboboxItem value="workflow">
                <ComboboxItemText>Workflow</ComboboxItemText>
                <ComboboxItemIndicator />
              </ComboboxItem>
            </ComboboxList>
          </ComboboxContent>
        </React.Fragment>
      )}
    </Combobox>,
  )

describe('Combobox wrappers', () => {
  describe('Select-like trigger', () => {
    it('should render label and trigger with combobox semantics', async () => {
      const screen = await renderSelectLikeCombobox()

      await expect.element(screen.getByText('Resource type')).toBeInTheDocument()
      await expect
        .element(screen.getByRole('combobox', { name: 'Resource type' }))
        .toBeInTheDocument()
    })
  })

  describe('Input group and controls', () => {
    it('should set input defaults and forward passthrough props', async () => {
      const screen = await renderInputCombobox({
        children: (
          <ComboboxInputGroup>
            <ComboboxInput
              aria-label="Search resources"
              className="custom-input"
              placeholder="Find a resource"
              required
            />
          </ComboboxInputGroup>
        ),
      })

      await expect
        .element(screen.getByRole('combobox', { name: 'Search resources' }))
        .toHaveAttribute('autocomplete', 'off')
      await expect
        .element(screen.getByRole('combobox', { name: 'Search resources' }))
        .toHaveAttribute('type', 'text')
      await expect
        .element(screen.getByRole('combobox', { name: 'Search resources' }))
        .toHaveAttribute('placeholder', 'Find a resource')
      await expect
        .element(screen.getByRole('combobox', { name: 'Search resources' }))
        .toBeRequired()
      await expect
        .element(screen.getByRole('combobox', { name: 'Search resources' }))
        .toHaveClass('custom-input')
    })

    it('should provide fallback aria labels and decorative icons for input controls', async () => {
      const screen = await renderInputCombobox()

      await expect
        .element(screen.getByRole('button', { name: 'Clear combobox' }))
        .toHaveAttribute('type', 'button')
      await expect
        .element(screen.getByRole('button', { name: 'Open combobox options' }))
        .toHaveAttribute('type', 'button')
    })

    it('should rely on aria-labelledby when provided instead of injecting fallback labels', async () => {
      const screen = await renderInputCombobox({
        children: (
          <React.Fragment>
            <span id="clear-label">Clear from label</span>
            <span id="trigger-label">Trigger from label</span>
            <ComboboxInputGroup>
              <ComboboxInput aria-label="Search resources" />
              <ComboboxClear aria-labelledby="clear-label" />
              <ComboboxInputTrigger aria-labelledby="trigger-label" />
            </ComboboxInputGroup>
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
      const screen = await renderSelectLikeCombobox({ open: true })

      await expect
        .element(screen.getByRole('group', { name: 'combobox positioner' }))
        .toHaveAttribute('data-side', 'bottom')
      await expect
        .element(screen.getByRole('group', { name: 'combobox positioner' }))
        .toHaveAttribute('data-align', 'start')
    })

    it('should apply custom placement side and passthrough popup props', async () => {
      const onPopupClick = vi.fn()
      const screen = await renderWithSafeViewport(
        <Combobox open defaultValue="workflow" items={['workflow']}>
          <ComboboxTrigger aria-label="Resource type">
            <ComboboxValue />
          </ComboboxTrigger>
          <ComboboxContent
            placement="top-end"
            sideOffset={12}
            alignOffset={6}
            positionerProps={{ role: 'group', 'aria-label': 'combobox positioner' }}
            popupProps={{
              role: 'dialog',
              'aria-label': 'combobox popup',
              onClick: onPopupClick,
            }}
          >
            <ComboboxList role="listbox" aria-label="combobox list">
              <ComboboxItem value="workflow">
                <ComboboxItemText>Workflow</ComboboxItemText>
              </ComboboxItem>
            </ComboboxList>
          </ComboboxContent>
        </Combobox>,
      )

      asHTMLElement(screen.getByRole('dialog', { name: 'combobox popup' }).element()).click()

      await expect
        .element(screen.getByRole('group', { name: 'combobox positioner' }))
        .toHaveAttribute('data-side', 'top')
      expect(onPopupClick).toHaveBeenCalledTimes(1)
    })

    it('should forward custom classes to group label separator item text and indicator', async () => {
      const screen = await renderWithSafeViewport(
        <Combobox open defaultValue="workflow" items={['workflow']}>
          <ComboboxTrigger aria-label="Resource type">
            <ComboboxValue />
          </ComboboxTrigger>
          <ComboboxContent popupProps={{ role: 'dialog', 'aria-label': 'combobox popup' }}>
            <ComboboxList role="listbox" aria-label="combobox list" data-testid="custom-list">
              <ComboboxGroup items={['workflow']}>
                <ComboboxGroupLabel className="custom-label">Resources</ComboboxGroupLabel>
                <ComboboxSeparator className="custom-separator" data-testid="separator" />
                <ComboboxItem value="workflow" className="custom-item">
                  <ComboboxItemText className="custom-text">Workflow</ComboboxItemText>
                  <ComboboxItemIndicator className="custom-indicator" data-testid="indicator" />
                </ComboboxItem>
              </ComboboxGroup>
            </ComboboxList>
          </ComboboxContent>
        </Combobox>,
      )

      await expect.element(screen.getByText('Resources')).toHaveClass('custom-label')
      await expect.element(screen.getByTestId('separator')).toHaveClass('custom-separator')
      await expect
        .element(screen.getByRole('option', { name: 'Workflow' }))
        .toHaveClass('custom-item')
      await expect
        .element(screen.getByTestId('custom-list').getByText('Workflow'))
        .toHaveClass('custom-text')
      await expect.element(screen.getByTestId('indicator')).toHaveClass('custom-indicator')
    })

    it('should navigate function-rendered items with arrow keys', async () => {
      const screen = await renderWithSafeViewport(
        <Combobox defaultValue="workflow" items={['workflow', 'dataset', 'app']}>
          <ComboboxInputGroup>
            <ComboboxInput aria-label="Search resources" />
          </ComboboxInputGroup>
          <ComboboxContent>
            <ComboboxList>
              {(item: string) => (
                <ComboboxItem key={item} value={item}>
                  <ComboboxItemText>{item}</ComboboxItemText>
                  <ComboboxItemIndicator />
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>,
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

  describe('Multiple selection chips', () => {
    it('should render chip wrappers and default remove button label', async () => {
      const screen = await renderWithSafeViewport(
        <Combobox multiple defaultValue={['maya']} items={['maya', 'nora']}>
          <ComboboxInputGroup>
            <ComboboxChips className="custom-chips" data-testid="chips">
              <ComboboxValue>
                {(selectedValue: string[]) => (
                  <React.Fragment>
                    {selectedValue.map((item) => (
                      <ComboboxChip key={item} className="custom-chip">
                        <span>{item}</span>
                        <ComboboxChipRemove data-testid="remove-chip" />
                      </ComboboxChip>
                    ))}
                    <ComboboxInput aria-label="Reviewers" />
                  </React.Fragment>
                )}
              </ComboboxValue>
            </ComboboxChips>
          </ComboboxInputGroup>
        </Combobox>,
      )

      await expect.element(screen.getByTestId('chips')).toHaveClass('custom-chips')
      await expect
        .element(screen.getByText('maya').element().parentElement!)
        .toHaveClass('custom-chip')
      await expect
        .element(screen.getByRole('button', { name: 'Remove selected item' }))
        .toHaveAttribute('type', 'button')
    })

    it('should preserve chip remove aria-labelledby over fallback label', async () => {
      const screen = await renderWithSafeViewport(
        <Combobox multiple defaultValue={['maya']} items={['maya']}>
          <ComboboxInputGroup>
            <ComboboxChips>
              <ComboboxValue>
                {(selectedValue: string[]) => (
                  <React.Fragment>
                    {selectedValue.map((item) => (
                      <ComboboxChip key={item}>
                        <span id="remove-maya">Remove Maya</span>
                        <ComboboxChipRemove aria-labelledby="remove-maya" />
                      </ComboboxChip>
                    ))}
                    <ComboboxInput aria-label="Reviewers" />
                  </React.Fragment>
                )}
              </ComboboxValue>
            </ComboboxChips>
          </ComboboxInputGroup>
        </Combobox>,
      )

      await expect
        .element(screen.getByRole('button', { name: 'Remove Maya' }))
        .not.toHaveAttribute('aria-label')
    })
  })
})
