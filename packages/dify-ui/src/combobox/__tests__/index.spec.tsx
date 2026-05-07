import type { ReactNode } from 'react'
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

const renderWithSafeViewport = (ui: ReactNode) => render(
  <div style={{ minHeight: '100vh', minWidth: '100vw', padding: '240px' }}>
    {ui}
  </div>,
)

const asHTMLElement = (element: HTMLElement | SVGElement) => element as HTMLElement

const renderSelectLikeCombobox = ({
  children,
  open = false,
}: {
  children?: ReactNode
  open?: boolean
} = {}) => renderWithSafeViewport(
  <Combobox open={open} defaultValue="workflow" items={['workflow', 'dataset']}>
    {children ?? (
      <>
        <ComboboxLabel data-testid="label">Resource type</ComboboxLabel>
        <ComboboxTrigger aria-label="Resource type" data-testid="trigger">
          <ComboboxValue placeholder="Select resource" />
        </ComboboxTrigger>
        <ComboboxContent
          positionerProps={{
            'role': 'group',
            'aria-label': 'combobox positioner',
          }}
          popupProps={{
            'role': 'dialog',
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
      </>
    )}
  </Combobox>,
)

const renderInputCombobox = ({
  children,
  open = false,
}: {
  children?: ReactNode
  open?: boolean
} = {}) => renderWithSafeViewport(
  <Combobox open={open} defaultValue="workflow" items={['workflow', 'dataset']}>
    {children ?? (
      <>
        <ComboboxInputGroup data-testid="input-group">
          <ComboboxInput aria-label="Search resources" data-testid="input" />
          <ComboboxClear data-testid="clear" />
          <ComboboxInputTrigger data-testid="input-trigger" />
        </ComboboxInputGroup>
        <ComboboxContent popupProps={{ 'role': 'dialog', 'aria-label': 'combobox popup' }}>
          <ComboboxList role="listbox" aria-label="combobox list">
            <ComboboxItem value="workflow">
              <ComboboxItemText>Workflow</ComboboxItemText>
              <ComboboxItemIndicator />
            </ComboboxItem>
          </ComboboxList>
        </ComboboxContent>
      </>
    )}
  </Combobox>,
)

describe('Combobox wrappers', () => {
  describe('Select-like trigger', () => {
    it('should render label and apply medium trigger classes by default', async () => {
      const screen = await renderSelectLikeCombobox()

      await expect.element(screen.getByText('Resource type')).toHaveClass('system-sm-medium')
      await expect.element(screen.getByRole('combobox', { name: 'Resource type' })).toHaveClass('rounded-lg')
      await expect.element(screen.getByRole('combobox', { name: 'Resource type' })).toHaveClass('system-sm-regular')
    })

    it('should apply small and large trigger size variants', async () => {
      const smallScreen = await renderSelectLikeCombobox({
        children: (
          <ComboboxTrigger aria-label="Small resource type" size="small">
            <ComboboxValue placeholder="Select resource" />
          </ComboboxTrigger>
        ),
      })

      await expect.element(smallScreen.getByRole('combobox', { name: 'Small resource type' })).toHaveClass('rounded-md')
      await expect.element(smallScreen.getByRole('combobox', { name: 'Small resource type' })).toHaveClass('system-xs-regular')

      const largeScreen = await renderSelectLikeCombobox({
        children: (
          <ComboboxTrigger aria-label="Large resource type" size="large">
            <ComboboxValue placeholder="Select resource" />
          </ComboboxTrigger>
        ),
      })

      await expect.element(largeScreen.getByRole('combobox', { name: 'Large resource type' })).toHaveClass('rounded-[10px]')
      await expect.element(largeScreen.getByRole('combobox', { name: 'Large resource type' })).toHaveClass('system-md-regular')
    })

    it('should render default trigger icon and support hiding it', async () => {
      const withIcon = await renderSelectLikeCombobox()

      expect(withIcon.getByTestId('trigger').element().querySelector('.i-ri-arrow-down-s-line')).toHaveAttribute('aria-hidden', 'true')

      const withoutIcon = await renderSelectLikeCombobox({
        children: (
          <ComboboxTrigger aria-label="Resource type without icon" icon={false}>
            <ComboboxValue placeholder="Select resource" />
          </ComboboxTrigger>
        ),
      })

      expect(withoutIcon.getByRole('combobox', { name: 'Resource type without icon' }).element().querySelector('.i-ri-arrow-down-s-line')).not.toBeInTheDocument()
    })
  })

  describe('Input group and controls', () => {
    it('should apply medium input group and input classes by default', async () => {
      const screen = await renderInputCombobox()

      await expect.element(screen.getByTestId('input-group')).toHaveClass('rounded-lg')
      await expect.element(screen.getByRole('combobox', { name: 'Search resources' })).toHaveClass('px-3')
      await expect.element(screen.getByRole('combobox', { name: 'Search resources' })).toHaveClass('system-sm-regular')
    })

    it('should apply large input group and input classes when large size is provided', async () => {
      const screen = await renderInputCombobox({
        children: (
          <ComboboxInputGroup size="large" data-testid="input-group">
            <ComboboxInput size="large" aria-label="Search resources" />
          </ComboboxInputGroup>
        ),
      })

      await expect.element(screen.getByTestId('input-group')).toHaveClass('rounded-[10px]')
      await expect.element(screen.getByRole('combobox', { name: 'Search resources' })).toHaveClass('px-4')
      await expect.element(screen.getByRole('combobox', { name: 'Search resources' })).toHaveClass('system-md-regular')
    })

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

      await expect.element(screen.getByRole('combobox', { name: 'Search resources' })).toHaveAttribute('autocomplete', 'off')
      await expect.element(screen.getByRole('combobox', { name: 'Search resources' })).toHaveAttribute('type', 'text')
      await expect.element(screen.getByRole('combobox', { name: 'Search resources' })).toHaveAttribute('placeholder', 'Find a resource')
      await expect.element(screen.getByRole('combobox', { name: 'Search resources' })).toBeRequired()
      await expect.element(screen.getByRole('combobox', { name: 'Search resources' })).toHaveClass('custom-input')
    })

    it('should provide fallback aria labels and decorative icons for input controls', async () => {
      const screen = await renderInputCombobox()

      await expect.element(screen.getByRole('button', { name: 'Clear combobox' })).toHaveAttribute('type', 'button')
      await expect.element(screen.getByRole('button', { name: 'Open combobox options' })).toHaveAttribute('type', 'button')
      expect(screen.getByRole('button', { name: 'Clear combobox' }).element().querySelector('.i-ri-close-line')).toHaveAttribute('aria-hidden', 'true')
      expect(screen.getByRole('button', { name: 'Open combobox options' }).element().querySelector('.i-ri-arrow-down-s-line')).toHaveAttribute('aria-hidden', 'true')
    })

    it('should rely on aria-labelledby when provided instead of injecting fallback labels', async () => {
      const screen = await renderInputCombobox({
        children: (
          <>
            <span id="clear-label">Clear from label</span>
            <span id="trigger-label">Trigger from label</span>
            <ComboboxInputGroup>
              <ComboboxInput aria-label="Search resources" />
              <ComboboxClear aria-labelledby="clear-label" />
              <ComboboxInputTrigger aria-labelledby="trigger-label" />
            </ComboboxInputGroup>
          </>
        ),
      })

      await expect.element(screen.getByRole('button', { name: 'Clear from label' })).not.toHaveAttribute('aria-label')
      await expect.element(screen.getByRole('button', { name: 'Trigger from label' })).not.toHaveAttribute('aria-label')
    })
  })

  describe('Content and options', () => {
    it('should use default overlay placement and Dify popup classes', async () => {
      const screen = await renderSelectLikeCombobox({ open: true })

      await expect.element(screen.getByRole('group', { name: 'combobox positioner' })).toHaveAttribute('data-side', 'bottom')
      await expect.element(screen.getByRole('group', { name: 'combobox positioner' })).toHaveAttribute('data-align', 'start')
      await expect.element(screen.getByRole('group', { name: 'combobox positioner' })).toHaveClass('z-1002')
      await expect.element(screen.getByRole('dialog', { name: 'combobox popup' })).toHaveClass('rounded-xl')
      await expect.element(screen.getByRole('dialog', { name: 'combobox popup' })).toHaveClass('w-(--anchor-width)')
      await expect.element(screen.getByRole('listbox', { name: 'combobox list' })).toHaveClass('scroll-py-1')
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
            positionerProps={{ 'role': 'group', 'aria-label': 'combobox positioner' }}
            popupProps={{
              'role': 'dialog',
              'aria-label': 'combobox popup',
              'onClick': onPopupClick,
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

      await expect.element(screen.getByRole('group', { name: 'combobox positioner' })).toHaveAttribute('data-side', 'top')
      expect(onPopupClick).toHaveBeenCalledTimes(1)
    })

    it('should render item text indicator status and empty wrappers with design classes', async () => {
      const screen = await renderSelectLikeCombobox({ open: true })

      await expect.element(screen.getByTestId('list').getByText('Workflow')).toHaveClass('system-sm-medium')
      await expect.element(screen.getByTestId('status')).toHaveClass('text-text-tertiary')
      await expect.element(screen.getByTestId('empty')).toHaveClass('system-sm-regular')
      expect(screen.getByTestId('list').getByText('Workflow').element().parentElement?.querySelector('.i-ri-check-line')).toHaveAttribute('aria-hidden', 'true')
    })

    it('should forward custom classes to group label separator item text and indicator', async () => {
      const screen = await renderWithSafeViewport(
        <Combobox open defaultValue="workflow" items={['workflow']}>
          <ComboboxTrigger aria-label="Resource type">
            <ComboboxValue />
          </ComboboxTrigger>
          <ComboboxContent popupProps={{ 'role': 'dialog', 'aria-label': 'combobox popup' }}>
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
      await expect.element(screen.getByRole('option', { name: 'Workflow' })).toHaveClass('custom-item')
      await expect.element(screen.getByTestId('custom-list').getByText('Workflow')).toHaveClass('custom-text')
      await expect.element(screen.getByTestId('indicator')).toHaveClass('custom-indicator')
    })
  })

  describe('Multiple selection chips', () => {
    it('should render chip wrappers and default remove button label', async () => {
      const screen = await renderWithSafeViewport(
        <Combobox multiple defaultValue={['maya']} items={['maya', 'nora']}>
          <ComboboxInputGroup>
            <ComboboxValue>
              {(selectedValue: string[]) => (
                <ComboboxChips className="custom-chips" data-testid="chips">
                  {selectedValue.map(item => (
                    <ComboboxChip key={item} className="custom-chip">
                      <span>{item}</span>
                      <ComboboxChipRemove data-testid="remove-chip" />
                    </ComboboxChip>
                  ))}
                </ComboboxChips>
              )}
            </ComboboxValue>
            <ComboboxInput aria-label="Reviewers" />
          </ComboboxInputGroup>
        </Combobox>,
      )

      await expect.element(screen.getByTestId('chips')).toHaveClass('custom-chips')
      await expect.element(screen.getByText('maya').element().parentElement!).toHaveClass('custom-chip')
      await expect.element(screen.getByRole('button', { name: 'Remove selected item' })).toHaveAttribute('type', 'button')
      expect(screen.getByTestId('remove-chip').element().querySelector('.i-ri-close-line')).toHaveAttribute('aria-hidden', 'true')
    })

    it('should preserve chip remove aria-labelledby over fallback label', async () => {
      const screen = await renderWithSafeViewport(
        <Combobox multiple defaultValue={['maya']} items={['maya']}>
          <ComboboxInputGroup>
            <ComboboxValue>
              {(selectedValue: string[]) => (
                <ComboboxChips>
                  {selectedValue.map(item => (
                    <ComboboxChip key={item}>
                      <span id="remove-maya">Remove Maya</span>
                      <ComboboxChipRemove aria-labelledby="remove-maya" />
                    </ComboboxChip>
                  ))}
                </ComboboxChips>
              )}
            </ComboboxValue>
            <ComboboxInput aria-label="Reviewers" />
          </ComboboxInputGroup>
        </Combobox>,
      )

      await expect.element(screen.getByRole('button', { name: 'Remove Maya' })).not.toHaveAttribute('aria-label')
    })
  })
})
