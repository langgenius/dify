import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CheckboxList from '..'

describe('checkbox list component', () => {
  const options = [
    { label: 'Option 1', value: 'option1' },
    { label: 'Option 2', value: 'option2' },
    { label: 'Option 3', value: 'option3' },
    { label: 'Apple', value: 'apple' },
  ]

  it('renders with title, description and options', () => {
    render(
      <CheckboxList
        title="Test Title"
        description="Test Description"
        options={options}
      />,
    )
    expect(screen.getByText('Test Title')).toBeInTheDocument()
    expect(screen.getByText('Test Description')).toBeInTheDocument()
    options.forEach((option) => {
      expect(screen.getByText(option.label)).toBeInTheDocument()
    })
  })

  it('filters options by label', async () => {
    render(<CheckboxList options={options} />)

    const input = screen.getByRole('textbox')
    await userEvent.type(input, 'app')

    expect(screen.getByText('Apple')).toBeInTheDocument()
    expect(screen.queryByText('Option 2')).not.toBeInTheDocument()
    expect(screen.queryByText('Option 3')).not.toBeInTheDocument()
  })

  it('renders select-all checkbox', () => {
    render(<CheckboxList options={options} showSelectAll />)
    const checkboxes = screen.getByTestId('checkbox-selectAll')
    expect(checkboxes).toBeInTheDocument()
  })

  it('selects all options when select-all is clicked', async () => {
    const onChange = vi.fn()

    render(
      <CheckboxList
        options={options}
        value={[]}
        onChange={onChange}
        showSelectAll
      />,
    )

    const selectAll = screen.getByTestId('checkbox-selectAll')
    await userEvent.click(selectAll)

    expect(onChange).toHaveBeenCalledWith(['option1', 'option2', 'option3', 'apple'])
  })

  it('does not select all options when select-all is clicked when disabled', async () => {
    const onChange = vi.fn()

    render(
      <CheckboxList
        options={options}
        value={[]}
        disabled
        showSelectAll
        onChange={onChange}
      />,
    )

    const selectAll = screen.getByTestId('checkbox-selectAll')
    await userEvent.click(selectAll)

    expect(onChange).not.toHaveBeenCalled()
  })

  it('deselects all options when select-all is clicked', async () => {
    const onChange = vi.fn()

    render(
      <CheckboxList
        options={options}
        value={['option1', 'option2', 'option3', 'apple']}
        onChange={onChange}
        showSelectAll
      />,
    )

    const selectAll = screen.getByTestId('checkbox-selectAll')
    await userEvent.click(selectAll)

    expect(onChange).toHaveBeenCalledWith([])
  })

  it('selects select-all when all options are clicked', async () => {
    const onChange = vi.fn()

    render(
      <CheckboxList
        options={options}
        value={['option1', 'option2', 'option3', 'apple']}
        onChange={onChange}
        showSelectAll
      />,
    )

    const selectAll = screen.getByTestId('checkbox-selectAll')
    expect(selectAll.querySelector('[data-testid="check-icon-selectAll"]')).toBeInTheDocument()
  })

  it('hides select-all checkbox when searching', async () => {
    render(<CheckboxList options={options} />)
    await userEvent.type(screen.getByRole('textbox'), 'app')
    expect(screen.queryByTestId('checkbox-selectAll')).not.toBeInTheDocument()
  })

  it('selects options when checkbox is clicked', async () => {
    const onChange = vi.fn()

    render(
      <CheckboxList
        options={options}
        value={[]}
        onChange={onChange}
        showSelectAll={false}
      />,
    )

    const selectOption = screen.getByTestId('checkbox-option1')
    await userEvent.click(selectOption)
    expect(onChange).toHaveBeenCalledWith(['option1'])
  })

  it('deselects options when checkbox is clicked when selected', async () => {
    const onChange = vi.fn()

    render(
      <CheckboxList
        options={options}
        value={['option1']}
        onChange={onChange}
        showSelectAll={false}
      />,
    )

    const selectOption = screen.getByTestId('checkbox-option1')
    await userEvent.click(selectOption)
    expect(onChange).toHaveBeenCalledWith([])
  })

  it('does not select options when checkbox is clicked', async () => {
    const onChange = vi.fn()

    render(
      <CheckboxList
        options={options}
        value={[]}
        onChange={onChange}
        disabled
      />,
    )

    const selectOption = screen.getByTestId('checkbox-option1')
    await userEvent.click(selectOption)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('Reset button works', async () => {
    const onChange = vi.fn()

    render(
      <CheckboxList
        options={options}
        value={[]}
        onChange={onChange}
      />,
    )

    const input = screen.getByRole('textbox')
    await userEvent.type(input, 'ban')
    await userEvent.click(screen.getByText('common.operation.resetKeywords'))
    expect(input).toHaveValue('')
  })

  it('does not toggle disabled option when clicked', async () => {
    const onChange = vi.fn()
    const disabledOptions = [
      { label: 'Enabled', value: 'enabled' },
      { label: 'Disabled', value: 'disabled', disabled: true },
    ]

    render(
      <CheckboxList
        options={disabledOptions}
        value={[]}
        onChange={onChange}
      />,
    )

    const disabledCheckbox = screen.getByTestId('checkbox-disabled')
    await userEvent.click(disabledCheckbox)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not toggle option when component is disabled and option is clicked via div', async () => {
    const onChange = vi.fn()

    render(
      <CheckboxList
        options={options}
        value={[]}
        onChange={onChange}
        disabled
      />,
    )

    // Find option and click the div container
    const optionLabels = screen.getAllByText('Option 1')
    const optionDiv = optionLabels[0].closest('[data-testid="option-item"]')
    expect(optionDiv).toBeInTheDocument()
    await userEvent.click(optionDiv as HTMLElement)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('renders with label prop', () => {
    render(
      <CheckboxList
        options={options}
        label="Test Label"
      />,
    )
    expect(screen.getByText('Test Label')).toBeInTheDocument()
  })

  it('renders without showSelectAll, showCount, showSearch', () => {
    render(
      <CheckboxList
        options={options}
        showSelectAll={false}
        showCount={false}
        showSearch={false}
      />,
    )
    expect(screen.queryByTestId('checkbox-selectAll')).not.toBeInTheDocument()
    options.forEach((option) => {
      expect(screen.getByText(option.label)).toBeInTheDocument()
    })
  })

  it('renders with custom containerClassName', () => {
    const { container } = render(
      <CheckboxList
        options={options}
        containerClassName="custom-class"
      />,
    )
    expect(container.querySelector('.custom-class')).toBeInTheDocument()
  })

  it('applies maxHeight style to options container', () => {
    render(
      <CheckboxList
        options={options}
        maxHeight="200px"
      />,
    )
    const optionsContainer = screen.getByTestId('options-container')
    expect(optionsContainer).toHaveStyle({ maxHeight: '200px', overflowY: 'auto' })
  })

  it('shows indeterminate state when some options are selected', async () => {
    const onChange = vi.fn()
    render(
      <CheckboxList
        options={options}
        value={['option1', 'option2']}
        onChange={onChange}
        showSelectAll
      />,
    )
    // When some but not all options are selected, clicking select-all should select all remaining options
    const selectAll = screen.getByTestId('checkbox-selectAll')
    expect(selectAll).toBeInTheDocument()
    expect(selectAll).toHaveAttribute('aria-checked', 'mixed')

    await userEvent.click(selectAll)
    expect(onChange).toHaveBeenCalledWith(['option1', 'option2', 'option3', 'apple'])
  })

  it('filters options correctly when searching', async () => {
    render(<CheckboxList options={options} />)

    const input = screen.getByRole('textbox')
    await userEvent.type(input, 'option')

    expect(screen.getByText('Option 1')).toBeInTheDocument()
    expect(screen.getByText('Option 2')).toBeInTheDocument()
    expect(screen.getByText('Option 3')).toBeInTheDocument()
    expect(screen.queryByText('Apple')).not.toBeInTheDocument()
  })

  it('shows no data message when no options match search', async () => {
    render(<CheckboxList options={options} />)

    const input = screen.getByRole('textbox')
    await userEvent.type(input, 'xyz')

    expect(screen.getByText(/common.operation.noSearchResults/i)).toBeInTheDocument()
  })

  it('toggles option by clicking option row', async () => {
    const onChange = vi.fn()

    render(
      <CheckboxList
        options={options}
        value={[]}
        onChange={onChange}
        showSelectAll={false}
      />,
    )

    const optionLabel = screen.getByText('Option 1')
    const optionRow = optionLabel.closest('div[data-testid="option-item"]')
    expect(optionRow).toBeInTheDocument()
    await userEvent.click(optionRow as HTMLElement)

    expect(onChange).toHaveBeenCalledWith(['option1'])
  })

  it('does not toggle when clicking disabled option row', async () => {
    const onChange = vi.fn()
    const disabledOptions = [
      { label: 'Option 1', value: 'option1', disabled: true },
    ]

    render(
      <CheckboxList
        options={disabledOptions}
        value={[]}
        onChange={onChange}
      />,
    )

    const optionRow = screen.getByText('Option 1').closest('div[data-testid="option-item"]')
    expect(optionRow).toBeInTheDocument()
    await userEvent.click(optionRow as HTMLElement)

    expect(onChange).not.toHaveBeenCalled()
  })

  it('renders without title and description', () => {
    render(
      <CheckboxList
        options={options}
        title=""
        description=""
      />,
    )
    expect(screen.queryByText(/Test Title/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Test Description/)).not.toBeInTheDocument()
  })

  it('shows correct filtered count message when searching', async () => {
    render(
      <CheckboxList
        options={options}
        title="Items"
      />,
    )

    const input = screen.getByRole('textbox')
    await userEvent.type(input, 'opt')

    expect(screen.getByText(/operation.searchCount/i)).toBeInTheDocument()
  })

  it('shows no data message when no options are provided', () => {
    render(
      <CheckboxList
        options={[]}
      />,
    )
    expect(screen.getByText('common.noData')).toBeInTheDocument()
  })

  it('does not toggle option when component is disabled even with enabled option', async () => {
    const onChange = vi.fn()
    const disabledOptions = [
      { label: 'Option', value: 'option' },
    ]

    render(
      <CheckboxList
        options={disabledOptions}
        value={[]}
        onChange={onChange}
        disabled
      />,
    )

    const checkbox = screen.getByTestId('checkbox-option')
    await userEvent.click(checkbox)
    expect(onChange).not.toHaveBeenCalled()
  })
})
