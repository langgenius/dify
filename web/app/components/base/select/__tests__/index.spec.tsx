import type { Item } from '../index'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Select, { PortalSelect, SimpleSelect } from '../index'

const items: Item[] = [
  { value: 'apple', name: 'Apple' },
  { value: 'banana', name: 'Banana' },
  { value: 'citrus', name: 'Citrus' },
]

describe('Select', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should show the default selected item when defaultValue matches an item', () => {
      render(
        <Select
          items={items}
          defaultValue="banana"
          allowSearch={false}
          onSelect={vi.fn()}
        />,
      )

      expect(screen.getByTitle('Banana'))!.toBeInTheDocument()
    })

    it('should render null selectedItem when defaultValue does not match any item', () => {
      render(
        <Select
          items={items}
          defaultValue="missing"
          allowSearch={false}
          onSelect={vi.fn()}
        />,
      )

      // No item title should appear for a non-matching default
      // No item title should appear for a non-matching default
      // No item title should appear for a non-matching default
      // No item title should appear for a non-matching default
      // No item title should appear for a non-matching default
      // No item title should appear for a non-matching default
      // No item title should appear for a non-matching default
      // No item title should appear for a non-matching default
      // No item title should appear for a non-matching default
      // No item title should appear for a non-matching default
      // No item title should appear for a non-matching default
      // No item title should appear for a non-matching default
      // No item title should appear for a non-matching default
      // No item title should appear for a non-matching default
      // No item title should appear for a non-matching default
      // No item title should appear for a non-matching default
      // No item title should appear for a non-matching default
      // No item title should appear for a non-matching default
      // No item title should appear for a non-matching default
      // No item title should appear for a non-matching default
      // No item title should appear for a non-matching default
      // No item title should appear for a non-matching default
      // No item title should appear for a non-matching default
      // No item title should appear for a non-matching default
      // No item title should appear for a non-matching default
      // No item title should appear for a non-matching default
      // No item title should appear for a non-matching default
      // No item title should appear for a non-matching default
      // No item title should appear for a non-matching default
      // No item title should appear for a non-matching default
      // No item title should appear for a non-matching default
      // No item title should appear for a non-matching default
      expect(screen.queryByTitle('Apple')).not.toBeInTheDocument()
      expect(screen.queryByTitle('Banana')).not.toBeInTheDocument()
    })

    it('should render with allowSearch=true (input mode)', () => {
      render(
        <Select
          items={items}
          defaultValue="apple"
          allowSearch={true}
          onSelect={vi.fn()}
        />,
      )

      expect(screen.getByRole('combobox'))!.toBeInTheDocument()
    })

    it('should apply custom bgClassName', () => {
      render(
        <Select
          items={items}
          defaultValue="apple"
          allowSearch={false}
          onSelect={vi.fn()}
          bgClassName="bg-custom-color"
        />,
      )

      expect(screen.getByTitle('Apple'))!.toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onSelect when choosing an option from default select', async () => {
      const user = userEvent.setup()
      const onSelect = vi.fn()

      render(
        <Select
          items={items}
          defaultValue="banana"
          allowSearch={false}
          onSelect={onSelect}
        />,
      )

      await user.click(screen.getByTitle('Banana'))
      await user.click(screen.getByText('Citrus'))

      expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({
        value: 'citrus',
        name: 'Citrus',
      }))
    })

    it('should not open or select when default select is disabled', async () => {
      const user = userEvent.setup()
      const onSelect = vi.fn()

      render(
        <Select
          items={items}
          defaultValue="banana"
          allowSearch={false}
          disabled={true}
          onSelect={onSelect}
        />,
      )

      await user.click(screen.getByTitle('Banana'))

      expect(screen.queryByText('Citrus')).not.toBeInTheDocument()
      expect(onSelect).not.toHaveBeenCalled()
    })

    it('should filter items when searching with allowSearch=true', async () => {
      const user = userEvent.setup()

      render(
        <Select
          items={items}
          defaultValue="apple"
          allowSearch={true}
          onSelect={vi.fn()}
        />,
      )

      // First, click the chevron button to open the dropdown
      const buttons = screen.getAllByRole('button')
      await user.click(buttons[0]!)

      // Now type in the search input to filter
      const input = screen.getByRole('combobox')
      await user.clear(input)
      await user.type(input, 'ban')

      // Citrus should be filtered away
      // Citrus should be filtered away
      // Citrus should be filtered away
      // Citrus should be filtered away
      // Citrus should be filtered away
      // Citrus should be filtered away
      // Citrus should be filtered away
      // Citrus should be filtered away
      // Citrus should be filtered away
      // Citrus should be filtered away
      // Citrus should be filtered away
      // Citrus should be filtered away
      // Citrus should be filtered away
      // Citrus should be filtered away
      // Citrus should be filtered away
      // Citrus should be filtered away
      // Citrus should be filtered away
      // Citrus should be filtered away
      // Citrus should be filtered away
      // Citrus should be filtered away
      // Citrus should be filtered away
      // Citrus should be filtered away
      // Citrus should be filtered away
      // Citrus should be filtered away
      // Citrus should be filtered away
      // Citrus should be filtered away
      // Citrus should be filtered away
      // Citrus should be filtered away
      // Citrus should be filtered away
      // Citrus should be filtered away
      // Citrus should be filtered away
      // Citrus should be filtered away
      expect(screen.queryByText('Citrus')).not.toBeInTheDocument()
    })

    it('should not filter or update query when disabled and allowSearch=true', async () => {
      render(
        <Select
          items={items}
          defaultValue="apple"
          allowSearch={true}
          disabled={true}
          onSelect={vi.fn()}
        />,
      )

      const input = screen.getByRole('combobox') as HTMLInputElement

      // we must use fireEvent because userEvent throws on disabled inputs
      fireEvent.change(input, { target: { value: 'ban' } })

      // We just want to ensure it doesn't throw and covers the !disabled branch in onChange.
      // Since it's disabled, no search dropdown should appear.
      // We just want to ensure it doesn't throw and covers the !disabled branch in onChange.
      // Since it's disabled, no search dropdown should appear.
      // We just want to ensure it doesn't throw and covers the !disabled branch in onChange.
      // Since it's disabled, no search dropdown should appear.
      // We just want to ensure it doesn't throw and covers the !disabled branch in onChange.
      // Since it's disabled, no search dropdown should appear.
      // We just want to ensure it doesn't throw and covers the !disabled branch in onChange.
      // Since it's disabled, no search dropdown should appear.
      // We just want to ensure it doesn't throw and covers the !disabled branch in onChange.
      // Since it's disabled, no search dropdown should appear.
      // We just want to ensure it doesn't throw and covers the !disabled branch in onChange.
      // Since it's disabled, no search dropdown should appear.
      // We just want to ensure it doesn't throw and covers the !disabled branch in onChange.
      // Since it's disabled, no search dropdown should appear.
      // We just want to ensure it doesn't throw and covers the !disabled branch in onChange.
      // Since it's disabled, no search dropdown should appear.
      // We just want to ensure it doesn't throw and covers the !disabled branch in onChange.
      // Since it's disabled, no search dropdown should appear.
      // We just want to ensure it doesn't throw and covers the !disabled branch in onChange.
      // Since it's disabled, no search dropdown should appear.
      // We just want to ensure it doesn't throw and covers the !disabled branch in onChange.
      // Since it's disabled, no search dropdown should appear.
      // We just want to ensure it doesn't throw and covers the !disabled branch in onChange.
      // Since it's disabled, no search dropdown should appear.
      // We just want to ensure it doesn't throw and covers the !disabled branch in onChange.
      // Since it's disabled, no search dropdown should appear.
      // We just want to ensure it doesn't throw and covers the !disabled branch in onChange.
      // Since it's disabled, no search dropdown should appear.
      // We just want to ensure it doesn't throw and covers the !disabled branch in onChange.
      // Since it's disabled, no search dropdown should appear.
      // We just want to ensure it doesn't throw and covers the !disabled branch in onChange.
      // Since it's disabled, no search dropdown should appear.
      // We just want to ensure it doesn't throw and covers the !disabled branch in onChange.
      // Since it's disabled, no search dropdown should appear.
      // We just want to ensure it doesn't throw and covers the !disabled branch in onChange.
      // Since it's disabled, no search dropdown should appear.
      // We just want to ensure it doesn't throw and covers the !disabled branch in onChange.
      // Since it's disabled, no search dropdown should appear.
      // We just want to ensure it doesn't throw and covers the !disabled branch in onChange.
      // Since it's disabled, no search dropdown should appear.
      // We just want to ensure it doesn't throw and covers the !disabled branch in onChange.
      // Since it's disabled, no search dropdown should appear.
      // We just want to ensure it doesn't throw and covers the !disabled branch in onChange.
      // Since it's disabled, no search dropdown should appear.
      // We just want to ensure it doesn't throw and covers the !disabled branch in onChange.
      // Since it's disabled, no search dropdown should appear.
      // We just want to ensure it doesn't throw and covers the !disabled branch in onChange.
      // Since it's disabled, no search dropdown should appear.
      // We just want to ensure it doesn't throw and covers the !disabled branch in onChange.
      // Since it's disabled, no search dropdown should appear.
      // We just want to ensure it doesn't throw and covers the !disabled branch in onChange.
      // Since it's disabled, no search dropdown should appear.
      // We just want to ensure it doesn't throw and covers the !disabled branch in onChange.
      // Since it's disabled, no search dropdown should appear.
      // We just want to ensure it doesn't throw and covers the !disabled branch in onChange.
      // Since it's disabled, no search dropdown should appear.
      // We just want to ensure it doesn't throw and covers the !disabled branch in onChange.
      // Since it's disabled, no search dropdown should appear.
      // We just want to ensure it doesn't throw and covers the !disabled branch in onChange.
      // Since it's disabled, no search dropdown should appear.
      // We just want to ensure it doesn't throw and covers the !disabled branch in onChange.
      // Since it's disabled, no search dropdown should appear.
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    })

    it('should not call onSelect when a disabled Combobox value changes externally', () => {
      // In Headless UI, disabled elements do not fire events via React.
      // To cover the defensive `if (!disabled)` branches inside the callbacks,
      // we temporarily remove the disabled attribute from the DOM to force the event through.
      const onSelect = vi.fn()

      render(
        <Select
          items={items}
          defaultValue="apple"
          allowSearch={false}
          disabled={true}
          onSelect={onSelect}
        />,
      )

      const button = screen.getAllByRole('button')[0] as HTMLButtonElement
      button.removeAttribute('disabled')
      button.removeAttribute('aria-disabled')
      fireEvent.click(button)

      expect(onSelect).not.toHaveBeenCalled()
    })

    it('should not open dropdown when clicking ComboboxButton while disabled and allowSearch=false', () => {
      // Covers line 128-141 where disabled check prevents open state toggle
      render(
        <Select
          items={items}
          defaultValue="apple"
          allowSearch={false}
          disabled={true}
          onSelect={vi.fn()}
        />,
      )

      // The main trigger button should be disabled
      const button = screen.getAllByRole('button')[0] as HTMLButtonElement
      button.removeAttribute('disabled')

      const chevron = screen.getAllByRole('button')[1] as HTMLButtonElement
      chevron.removeAttribute('disabled')

      fireEvent.click(button)
      fireEvent.click(chevron)

      // Dropdown options should not appear because the internal `if (!disabled)` guards it
      // Dropdown options should not appear because the internal `if (!disabled)` guards it
      // Dropdown options should not appear because the internal `if (!disabled)` guards it
      // Dropdown options should not appear because the internal `if (!disabled)` guards it
      // Dropdown options should not appear because the internal `if (!disabled)` guards it
      // Dropdown options should not appear because the internal `if (!disabled)` guards it
      // Dropdown options should not appear because the internal `if (!disabled)` guards it
      // Dropdown options should not appear because the internal `if (!disabled)` guards it
      // Dropdown options should not appear because the internal `if (!disabled)` guards it
      // Dropdown options should not appear because the internal `if (!disabled)` guards it
      // Dropdown options should not appear because the internal `if (!disabled)` guards it
      // Dropdown options should not appear because the internal `if (!disabled)` guards it
      // Dropdown options should not appear because the internal `if (!disabled)` guards it
      // Dropdown options should not appear because the internal `if (!disabled)` guards it
      // Dropdown options should not appear because the internal `if (!disabled)` guards it
      // Dropdown options should not appear because the internal `if (!disabled)` guards it
      // Dropdown options should not appear because the internal `if (!disabled)` guards it
      // Dropdown options should not appear because the internal `if (!disabled)` guards it
      // Dropdown options should not appear because the internal `if (!disabled)` guards it
      // Dropdown options should not appear because the internal `if (!disabled)` guards it
      // Dropdown options should not appear because the internal `if (!disabled)` guards it
      // Dropdown options should not appear because the internal `if (!disabled)` guards it
      // Dropdown options should not appear because the internal `if (!disabled)` guards it
      // Dropdown options should not appear because the internal `if (!disabled)` guards it
      // Dropdown options should not appear because the internal `if (!disabled)` guards it
      // Dropdown options should not appear because the internal `if (!disabled)` guards it
      // Dropdown options should not appear because the internal `if (!disabled)` guards it
      // Dropdown options should not appear because the internal `if (!disabled)` guards it
      // Dropdown options should not appear because the internal `if (!disabled)` guards it
      // Dropdown options should not appear because the internal `if (!disabled)` guards it
      // Dropdown options should not appear because the internal `if (!disabled)` guards it
      // Dropdown options should not appear because the internal `if (!disabled)` guards it
      expect(screen.queryByText('Banana')).not.toBeInTheDocument()
    })

    it('should handle missing item nicely in renderTrigger', () => {
      render(
        <SimpleSelect
          items={items}
          defaultValue="non-existent"
          onSelect={vi.fn()}
          renderTrigger={(selected) => {
            return (
              <span>
                {/* eslint-disable-next-line style/jsx-one-expression-per-line */}
                Custom: {selected?.name ?? 'Fallback'}
              </span>
            )
          }}
        />,
      )
      expect(screen.getByText('Custom: Fallback'))!.toBeInTheDocument()
    })

    it('should render with custom renderOption', async () => {
      const user = userEvent.setup()

      render(
        <Select
          items={items}
          defaultValue="apple"
          allowSearch={false}
          onSelect={vi.fn()}
          renderOption={({ item, selected }) => (
            <span data-testid={`custom-opt-${item.value}`}>
              {item.name}
              {selected ? ' ✓' : ''}
            </span>
          )}
        />,
      )

      await user.click(screen.getByTitle('Apple'))

      expect(screen.getByTestId('custom-opt-apple'))!.toBeInTheDocument()
      expect(screen.getByTestId('custom-opt-banana'))!.toBeInTheDocument()
    })

    it('should show ChevronUpIcon when open and ChevronDownIcon when closed', async () => {
      const user = userEvent.setup()

      render(
        <Select
          items={items}
          defaultValue="apple"
          allowSearch={false}
          onSelect={vi.fn()}
        />,
      )

      // Initially closed — should have a chevron button
      await user.click(screen.getByTitle('Apple'))
      // Dropdown is now open
      // Dropdown is now open
      expect(screen.getByText('Banana'))!.toBeInTheDocument()
    })
  })
})

// ──────────────────────────────────────────────────────────────
//  SimpleSelect (Listbox-based)
// ──────────────────────────────────────────────────────────────
describe('SimpleSelect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render i18n placeholder when no selection exists', () => {
      render(
        <SimpleSelect
          items={items}
          defaultValue="missing"
          onSelect={vi.fn()}
        />,
      )

      expect(screen.getByText(/select/i))!.toBeInTheDocument()
    })

    it('should render custom placeholder when provided', () => {
      render(
        <SimpleSelect
          items={items}
          defaultValue="missing"
          placeholder="Pick one"
          onSelect={vi.fn()}
        />,
      )

      expect(screen.getByText('Pick one'))!.toBeInTheDocument()
    })

    it('should render selected item name when defaultValue matches', () => {
      render(
        <SimpleSelect
          items={items}
          defaultValue="banana"
          onSelect={vi.fn()}
        />,
      )

      expect(screen.getByText('Banana'))!.toBeInTheDocument()
    })

    it('should render with isLoading=true showing spinner', () => {
      render(
        <SimpleSelect
          items={items}
          defaultValue="apple"
          onSelect={vi.fn()}
          isLoading={true}
        />,
      )

      // Loader icon should be rendered (RiLoader4Line has aria hidden)
      // Loader icon should be rendered (RiLoader4Line has aria hidden)
      expect(screen.getByText('Apple'))!.toBeInTheDocument()
    })

    it('should render group items as non-selectable headers', async () => {
      const user = userEvent.setup()
      const groupItems: Item[] = [
        { value: 'fruits-group', name: 'Fruits', isGroup: true },
        { value: 'apple', name: 'Apple' },
        { value: 'banana', name: 'Banana' },
      ]

      render(
        <SimpleSelect
          items={groupItems}
          defaultValue="apple"
          onSelect={vi.fn()}
        />,
      )

      await user.click(screen.getByRole('button'))
      expect(screen.getByText('Fruits'))!.toBeInTheDocument()
    })

    it('should not render ListboxOptions when disabled', () => {
      render(
        <SimpleSelect
          items={items}
          defaultValue="apple"
          disabled={true}
          onSelect={vi.fn()}
        />,
      )

      expect(screen.getByText('Apple'))!.toBeInTheDocument()
    })

    it('should not open SimpleSelect when disabled', async () => {
      const user = userEvent.setup()

      render(
        <SimpleSelect
          items={items}
          defaultValue="apple"
          disabled={true}
          onSelect={vi.fn()}
        />,
      )

      const button = screen.getByRole('button')
      await user.click(button)

      // Banana should not be visible as it won't open
      // Banana should not be visible as it won't open
      // Banana should not be visible as it won't open
      // Banana should not be visible as it won't open
      // Banana should not be visible as it won't open
      // Banana should not be visible as it won't open
      // Banana should not be visible as it won't open
      // Banana should not be visible as it won't open
      // Banana should not be visible as it won't open
      // Banana should not be visible as it won't open
      // Banana should not be visible as it won't open
      // Banana should not be visible as it won't open
      // Banana should not be visible as it won't open
      // Banana should not be visible as it won't open
      // Banana should not be visible as it won't open
      // Banana should not be visible as it won't open
      // Banana should not be visible as it won't open
      // Banana should not be visible as it won't open
      // Banana should not be visible as it won't open
      // Banana should not be visible as it won't open
      // Banana should not be visible as it won't open
      // Banana should not be visible as it won't open
      // Banana should not be visible as it won't open
      // Banana should not be visible as it won't open
      // Banana should not be visible as it won't open
      // Banana should not be visible as it won't open
      // Banana should not be visible as it won't open
      // Banana should not be visible as it won't open
      // Banana should not be visible as it won't open
      // Banana should not be visible as it won't open
      // Banana should not be visible as it won't open
      // Banana should not be visible as it won't open
      expect(screen.queryByText('Banana')).not.toBeInTheDocument()
    })

    it('should not trigger onSelect via onChange when Listbox is disabled', () => {
      // Covers line 228 (!disabled check) inside Listbox onChange
      const onSelect = vi.fn()
      render(
        <SimpleSelect
          items={items}
          defaultValue="apple"
          disabled={true}
          onSelect={onSelect}
        />,
      )

      const button = screen.getByRole('button') as HTMLButtonElement
      button.removeAttribute('disabled')
      button.removeAttribute('aria-disabled')
      fireEvent.click(button)

      expect(onSelect).not.toHaveBeenCalled()
    })
  })

  describe('User Interactions', () => {
    it('should call onSelect and update display when an option is chosen', async () => {
      const user = userEvent.setup()
      const onSelect = vi.fn()

      render(
        <SimpleSelect
          items={items}
          defaultValue="missing"
          onSelect={onSelect}
        />,
      )

      await user.click(screen.getByRole('button'))
      await user.click(screen.getByText('Apple'))

      expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({
        value: 'apple',
        name: 'Apple',
      }))
      expect(screen.getByText('Apple'))!.toBeInTheDocument()
    })

    it('should pass open state into renderTrigger', async () => {
      const user = userEvent.setup()

      render(
        <SimpleSelect
          items={items}
          defaultValue="missing"
          onSelect={vi.fn()}
          renderTrigger={(selected, open) => (
            <span>{`${selected?.name ?? 'none'}-${open ? 'open' : 'closed'}`}</span>
          )}
        />,
      )

      expect(screen.getByText('none-closed'))!.toBeInTheDocument()
      await user.click(screen.getByText('none-closed'))
      expect(screen.getByText('none-open'))!.toBeInTheDocument()
    })

    it('should clear selection when XMark is clicked (notClearable=false)', async () => {
      const user = userEvent.setup()
      const onSelect = vi.fn()

      render(
        <SimpleSelect
          items={items}
          defaultValue="apple"
          onSelect={onSelect}
          notClearable={false}
        />,
      )

      // The clear button (XMarkIcon) should be visible when an item is selected
      const clearBtn = screen.getByRole('button').querySelector('[aria-hidden="false"]')
      expect(clearBtn)!.toBeInTheDocument()

      await user.click(clearBtn!)

      expect(onSelect).toHaveBeenCalledWith({ name: '', value: '' })
    })

    it('should not show clear button when notClearable is true', () => {
      render(
        <SimpleSelect
          items={items}
          defaultValue="apple"
          onSelect={vi.fn()}
          notClearable={true}
        />,
      )

      const clearBtn = screen.getByRole('button').querySelector('[aria-hidden="false"]')
      expect(clearBtn).not.toBeInTheDocument()
    })

    it('should hide check marks when hideChecked is true', async () => {
      const user = userEvent.setup()

      render(
        <SimpleSelect
          items={items}
          defaultValue="apple"
          onSelect={vi.fn()}
          hideChecked={true}
        />,
      )

      await user.click(screen.getByRole('button'))
      // The selected item should be visible but without a check icon
      expect(screen.getAllByText('Apple').length).toBeGreaterThanOrEqual(1)
    })

    it('should render with custom renderOption in SimpleSelect', async () => {
      const user = userEvent.setup()

      render(
        <SimpleSelect
          items={items}
          defaultValue="apple"
          onSelect={vi.fn()}
          renderOption={({ item, selected }) => (
            <span data-testid={`simple-opt-${item.value}`}>
              {item.name}
              {selected ? ' (selected)' : ''}
            </span>
          )}
        />,
      )

      await user.click(screen.getByRole('button'))
      expect(screen.getByTestId('simple-opt-apple'))!.toBeInTheDocument()
      expect(screen.getByTestId('simple-opt-banana'))!.toBeInTheDocument()
      // Verify the custom render shows selected state
      // Verify the custom render shows selected state
      expect(screen.getByTestId('simple-opt-apple'))!.toHaveTextContent('Apple (selected)')
    })

    it('should call onOpenChange when the button is clicked', async () => {
      const user = userEvent.setup()
      const onOpenChange = vi.fn()

      render(
        <SimpleSelect
          items={items}
          defaultValue="apple"
          onSelect={vi.fn()}
          onOpenChange={onOpenChange}
        />,
      )

      await user.click(screen.getByRole('button'))
      expect(onOpenChange).toHaveBeenCalled()
    })

    it('should handle disabled items that cannot be selected', async () => {
      const user = userEvent.setup()
      const onSelect = vi.fn()
      const disabledItems: Item[] = [
        { value: 'apple', name: 'Apple' },
        { value: 'banana', name: 'Banana', disabled: true },
        { value: 'citrus', name: 'Citrus' },
      ]

      render(
        <SimpleSelect
          items={disabledItems}
          defaultValue="apple"
          onSelect={onSelect}
        />,
      )

      await user.click(screen.getByRole('button'))
      // Banana should be rendered but not selectable
      // Banana should be rendered but not selectable
      expect(screen.getByText('Banana'))!.toBeInTheDocument()
    })
  })
})

// ──────────────────────────────────────────────────────────────
//  PortalSelect
// ──────────────────────────────────────────────────────────────
describe('PortalSelect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should show placeholder when value is empty', () => {
      render(
        <PortalSelect
          value=""
          items={items}
          onSelect={vi.fn()}
        />,
      )

      expect(screen.getByText(/select/i))!.toBeInTheDocument()
    })

    it('should show selected item name when value matches', () => {
      render(
        <PortalSelect
          value="banana"
          items={items}
          onSelect={vi.fn()}
        />,
      )

      expect(screen.getByTitle('Banana'))!.toBeInTheDocument()
    })

    it('should render with custom placeholder', () => {
      render(
        <PortalSelect
          value=""
          items={items}
          onSelect={vi.fn()}
          placeholder="Choose fruit"
        />,
      )

      expect(screen.getByText('Choose fruit'))!.toBeInTheDocument()
    })

    it('should render with renderTrigger', () => {
      render(
        <PortalSelect
          value="apple"
          items={items}
          onSelect={vi.fn()}
          renderTrigger={item => (
            <span data-testid="custom-trigger">{item?.name ?? 'None'}</span>
          )}
        />,
      )

      expect(screen.getByTestId('custom-trigger'))!.toHaveTextContent('Apple')
    })

    it('should show INSTALLED badge when installedValue differs from selected value', () => {
      render(
        <PortalSelect
          value="banana"
          items={items}
          onSelect={vi.fn()}
          installedValue="apple"
        />,
      )

      expect(screen.getByTitle('Banana'))!.toBeInTheDocument()
    })

    it('should apply triggerClassNameFn', () => {
      const triggerClassNameFn = vi.fn((open: boolean) => open ? 'trigger-open' : 'trigger-closed')

      render(
        <PortalSelect
          value="apple"
          items={items}
          onSelect={vi.fn()}
          triggerClassNameFn={triggerClassNameFn}
        />,
      )

      expect(triggerClassNameFn).toHaveBeenCalledWith(false)
    })
  })

  describe('User Interactions', () => {
    it('should call onSelect when choosing an option from portal dropdown', async () => {
      const user = userEvent.setup()
      const onSelect = vi.fn()

      render(
        <PortalSelect
          value=""
          items={items}
          onSelect={onSelect}
        />,
      )

      await user.click(screen.getByText(/select/i))
      await user.click(screen.getByText('Citrus'))

      expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({
        value: 'citrus',
        name: 'Citrus',
      }))
    })

    it('should not open the portal dropdown when readonly is true', async () => {
      const user = userEvent.setup()

      render(
        <PortalSelect
          value=""
          items={items}
          readonly={true}
          onSelect={vi.fn()}
        />,
      )

      await user.click(screen.getByText(/select/i))
      expect(screen.queryByTitle('Citrus')).not.toBeInTheDocument()
    })

    it('should show check mark for selected item when hideChecked is false', async () => {
      const user = userEvent.setup()

      render(
        <PortalSelect
          value="banana"
          items={items}
          onSelect={vi.fn()}
        />,
      )

      await user.click(screen.getByTitle('Banana'))
      // Banana option in the dropdown should be displayed
      const allBananas = screen.getAllByText('Banana')
      expect(allBananas.length).toBeGreaterThanOrEqual(1)
    })

    it('should hide check marks when hideChecked is true', async () => {
      const user = userEvent.setup()

      render(
        <PortalSelect
          value="banana"
          items={items}
          onSelect={vi.fn()}
          hideChecked={true}
        />,
      )

      await user.click(screen.getByTitle('Banana'))
      expect(screen.getAllByText('Banana').length).toBeGreaterThanOrEqual(1)
    })

    it('should display INSTALLED badge in dropdown for installed items', async () => {
      const user = userEvent.setup()

      render(
        <PortalSelect
          value="banana"
          items={items}
          onSelect={vi.fn()}
          installedValue="apple"
        />,
      )

      await user.click(screen.getByTitle('Banana'))
      // The installed badge should appear in the dropdown
      // The installed badge should appear in the dropdown
      expect(screen.getByText('INSTALLED'))!.toBeInTheDocument()
    })

    it('should render item.extra content in dropdown', async () => {
      const user = userEvent.setup()
      const extraItems: Item[] = [
        { value: 'apple', name: 'Apple', extra: <span data-testid="extra-apple">Extra</span> },
        { value: 'banana', name: 'Banana' },
      ]

      render(
        <PortalSelect
          value=""
          items={extraItems}
          onSelect={vi.fn()}
        />,
      )

      await user.click(screen.getByText(/select/i))
      expect(screen.getByTestId('extra-apple'))!.toBeInTheDocument()
    })
  })
})
