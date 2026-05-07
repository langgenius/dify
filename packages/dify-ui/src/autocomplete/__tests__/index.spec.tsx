import type { ReactNode } from 'react'
import { render } from 'vitest-browser-react'
import {
  Autocomplete,
  AutocompleteClear,
  AutocompleteContent,
  AutocompleteEmpty,
  AutocompleteGroup,
  AutocompleteInput,
  AutocompleteInputGroup,
  AutocompleteItem,
  AutocompleteItemIndicator,
  AutocompleteItemText,
  AutocompleteLabel,
  AutocompleteList,
  AutocompleteSeparator,
  AutocompleteStatus,
  AutocompleteTrigger,
} from '../index'

const renderWithSafeViewport = (ui: ReactNode) => render(
  <div style={{ minHeight: '100vh', minWidth: '100vw', padding: '240px' }}>
    {ui}
  </div>,
)

const asHTMLElement = (element: HTMLElement | SVGElement) => element as HTMLElement

const renderAutocomplete = ({
  children,
  open = false,
  defaultValue = 'workflow',
}: {
  children?: ReactNode
  open?: boolean
  defaultValue?: string
} = {}) => renderWithSafeViewport(
  <Autocomplete open={open} defaultValue={defaultValue} items={['workflow', 'dataset']}>
    {children ?? (
      <>
        <AutocompleteInputGroup data-testid="input-group">
          <AutocompleteInput aria-label="Search suggestions" data-testid="input" />
          <AutocompleteClear data-testid="clear" />
          <AutocompleteTrigger data-testid="trigger" />
        </AutocompleteInputGroup>
        <AutocompleteContent
          positionerProps={{
            'role': 'group',
            'aria-label': 'autocomplete positioner',
          }}
          popupProps={{
            'role': 'dialog',
            'aria-label': 'autocomplete popup',
          }}
        >
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
        </AutocompleteContent>
      </>
    )}
  </Autocomplete>,
)

describe('Autocomplete wrappers', () => {
  describe('Input group and input', () => {
    it('should apply medium input group and input classes by default', async () => {
      const screen = await renderAutocomplete()

      await expect.element(screen.getByTestId('input-group')).toHaveClass('rounded-lg')
      await expect.element(screen.getByRole('combobox', { name: 'Search suggestions' })).toHaveClass('px-3')
      await expect.element(screen.getByRole('combobox', { name: 'Search suggestions' })).toHaveClass('system-sm-regular')
    })

    it('should apply large input group and input classes when large size is provided', async () => {
      const screen = await renderAutocomplete({
        children: (
          <AutocompleteInputGroup size="large" data-testid="input-group">
            <AutocompleteInput size="large" aria-label="Search suggestions" data-testid="input" />
          </AutocompleteInputGroup>
        ),
      })

      await expect.element(screen.getByTestId('input-group')).toHaveClass('rounded-[10px]')
      await expect.element(screen.getByRole('combobox', { name: 'Search suggestions' })).toHaveClass('px-4')
      await expect.element(screen.getByRole('combobox', { name: 'Search suggestions' })).toHaveClass('system-md-regular')
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

      await expect.element(screen.getByRole('combobox', { name: 'Search suggestions' })).toHaveAttribute('autocomplete', 'off')
      await expect.element(screen.getByRole('combobox', { name: 'Search suggestions' })).toHaveAttribute('type', 'text')
      await expect.element(screen.getByRole('combobox', { name: 'Search suggestions' })).toHaveAttribute('placeholder', 'Find a resource')
      await expect.element(screen.getByRole('combobox', { name: 'Search suggestions' })).toBeRequired()
      await expect.element(screen.getByRole('combobox', { name: 'Search suggestions' })).toHaveClass('custom-input')
    })
  })

  describe('Controls', () => {
    it('should provide fallback aria labels and decorative icons when labels are omitted', async () => {
      const screen = await renderAutocomplete()

      await expect.element(screen.getByRole('button', { name: 'Clear autocomplete' })).toHaveAttribute('type', 'button')
      await expect.element(screen.getByRole('button', { name: 'Open autocomplete suggestions' })).toHaveAttribute('type', 'button')
      expect(screen.getByRole('button', { name: 'Clear autocomplete' }).element().querySelector('.i-ri-close-line')).toHaveAttribute('aria-hidden', 'true')
      expect(screen.getByRole('button', { name: 'Open autocomplete suggestions' }).element().querySelector('.i-ri-arrow-down-s-line')).toHaveAttribute('aria-hidden', 'true')
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

      expect(screen.getByRole('button', { name: 'Reset search' }).element()).toContainElement(screen.getByTestId('custom-clear').element())
      expect(screen.getByRole('button', { name: 'Show suggestions' }).element()).toContainElement(screen.getByTestId('custom-trigger').element())
      expect(screen.getByRole('button', { name: 'Reset search' }).element().querySelector('.i-ri-close-line')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Show suggestions' }).element().querySelector('.i-ri-arrow-down-s-line')).not.toBeInTheDocument()
    })

    it('should rely on aria-labelledby when provided instead of injecting fallback labels', async () => {
      const screen = await renderAutocomplete({
        children: (
          <>
            <span id="clear-label">Clear from label</span>
            <span id="trigger-label">Trigger from label</span>
            <AutocompleteInputGroup>
              <AutocompleteInput aria-label="Search suggestions" />
              <AutocompleteClear aria-labelledby="clear-label" />
              <AutocompleteTrigger aria-labelledby="trigger-label" />
            </AutocompleteInputGroup>
          </>
        ),
      })

      await expect.element(screen.getByRole('button', { name: 'Clear from label' })).not.toHaveAttribute('aria-label')
      await expect.element(screen.getByRole('button', { name: 'Trigger from label' })).not.toHaveAttribute('aria-label')
    })
  })

  describe('Content and options', () => {
    it('should use default overlay placement and Dify popup classes', async () => {
      const screen = await renderAutocomplete({ open: true })

      await expect.element(screen.getByRole('group', { name: 'autocomplete positioner' })).toHaveAttribute('data-side', 'bottom')
      await expect.element(screen.getByRole('group', { name: 'autocomplete positioner' })).toHaveAttribute('data-align', 'start')
      await expect.element(screen.getByRole('group', { name: 'autocomplete positioner' })).toHaveClass('z-1002')
      await expect.element(screen.getByRole('dialog', { name: 'autocomplete popup' })).toHaveClass('rounded-xl')
      await expect.element(screen.getByRole('dialog', { name: 'autocomplete popup' })).toHaveClass('w-(--anchor-width)')
      await expect.element(screen.getByRole('listbox', { name: 'autocomplete list' })).toHaveClass('scroll-py-1')
    })

    it('should apply custom placement side and passthrough popup props', async () => {
      const onPopupClick = vi.fn()
      const screen = await renderWithSafeViewport(
        <Autocomplete open defaultValue="workflow" items={['workflow']}>
          <AutocompleteInputGroup>
            <AutocompleteInput aria-label="Search suggestions" />
          </AutocompleteInputGroup>
          <AutocompleteContent
            placement="top-end"
            sideOffset={12}
            alignOffset={6}
            positionerProps={{ 'role': 'group', 'aria-label': 'autocomplete positioner' }}
            popupProps={{
              'role': 'dialog',
              'aria-label': 'autocomplete popup',
              'onClick': onPopupClick,
            }}
          >
            <AutocompleteList role="listbox" aria-label="autocomplete list">
              <AutocompleteItem value="workflow">
                <AutocompleteItemText>Workflow</AutocompleteItemText>
              </AutocompleteItem>
            </AutocompleteList>
          </AutocompleteContent>
        </Autocomplete>,
      )

      asHTMLElement(screen.getByRole('dialog', { name: 'autocomplete popup' }).element()).click()

      await expect.element(screen.getByRole('group', { name: 'autocomplete positioner' })).toHaveAttribute('data-side', 'top')
      expect(onPopupClick).toHaveBeenCalledTimes(1)
    })

    it('should render item text indicator status and empty wrappers with design classes', async () => {
      const screen = await renderAutocomplete({ open: true })

      await expect.element(screen.getByText('Workflow')).toHaveClass('system-sm-medium')
      await expect.element(screen.getByTestId('status')).toHaveClass('text-text-tertiary')
      await expect.element(screen.getByTestId('empty')).toHaveClass('system-sm-regular')
      expect(screen.getByText('Workflow').element().parentElement?.querySelector('.i-ri-arrow-right-line')).toHaveAttribute('aria-hidden', 'true')
    })

    it('should forward custom classes to label separator item text and indicator', async () => {
      const screen = await renderWithSafeViewport(
        <Autocomplete open defaultValue="workflow" items={['workflow']}>
          <AutocompleteInputGroup>
            <AutocompleteInput aria-label="Search suggestions" />
          </AutocompleteInputGroup>
          <AutocompleteContent popupProps={{ 'role': 'dialog', 'aria-label': 'autocomplete popup' }}>
            <AutocompleteList role="listbox" aria-label="autocomplete list">
              <AutocompleteGroup items={['workflow']}>
                <AutocompleteLabel className="custom-label">Resources</AutocompleteLabel>
                <AutocompleteSeparator className="custom-separator" data-testid="separator" />
                <AutocompleteItem value="workflow" className="custom-item">
                  <AutocompleteItemText className="custom-text">Workflow</AutocompleteItemText>
                  <AutocompleteItemIndicator className="custom-indicator" data-testid="indicator" />
                </AutocompleteItem>
              </AutocompleteGroup>
            </AutocompleteList>
          </AutocompleteContent>
        </Autocomplete>,
      )

      await expect.element(screen.getByText('Resources')).toHaveClass('custom-label')
      await expect.element(screen.getByTestId('separator')).toHaveClass('custom-separator')
      await expect.element(screen.getByRole('option', { name: 'Workflow' })).toHaveClass('custom-item')
      await expect.element(screen.getByText('Workflow')).toHaveClass('custom-text')
      await expect.element(screen.getByTestId('indicator')).toHaveClass('custom-indicator')
    })
  })
})
