import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CheckboxList } from '..'

describe('checkbox list component', () => {
  const selectAllName = 'common.operation.selectAll'
  const getSearchInput = () => screen.getByRole('searchbox', { name: 'common.operation.search' })
  const options = [
    { label: 'Option 1', value: 'option1' },
    { label: 'Option 2', value: 'option2' },
    { label: 'Option 3', value: 'option3' },
    { label: 'Apple', value: 'apple' },
  ]

  it('renders with title, description and options', () => {
    render(<CheckboxList title="Test Title" description="Test Description" options={options} />)
    expect(screen.getByText('Test Title'))!.toBeInTheDocument()
    expect(screen.getByText('Test Description'))!.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Test Title' }))!.toHaveAccessibleDescription(
      'Test Description',
    )
    options.forEach((option) => {
      expect(screen.getByText(option.label))!.toBeInTheDocument()
    })
  })

  it('filters options by label', async () => {
    const user = userEvent.setup()
    render(<CheckboxList options={options} />)

    const input = getSearchInput()
    await user.type(input, 'app')

    expect(screen.getByText('Apple'))!.toBeInTheDocument()
    expect(screen.queryByText('Option 2')).not.toBeInTheDocument()
    expect(screen.queryByText('Option 3')).not.toBeInTheDocument()
  })

  it('selects all options when select-all is clicked', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<CheckboxList options={options} value={[]} onChange={onChange} showSelectAll />)

    const selectAll = screen.getByRole('checkbox', { name: selectAllName })
    await user.click(selectAll)

    expect(onChange).toHaveBeenCalledWith(['option1', 'option2', 'option3', 'apple'])
  })

  it('does not select all options when select-all is clicked when disabled', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<CheckboxList options={options} value={[]} disabled showSelectAll onChange={onChange} />)

    const selectAll = screen.getByRole('checkbox', { name: selectAllName })
    await user.click(selectAll)

    expect(onChange).not.toHaveBeenCalled()
  })

  it('deselects all options when select-all is clicked', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <CheckboxList
        options={options}
        value={['option1', 'option2', 'option3', 'apple']}
        onChange={onChange}
        showSelectAll
      />,
    )

    const selectAll = screen.getByRole('checkbox', { name: selectAllName })
    expect(selectAll).toBeChecked()
    await user.click(selectAll)

    expect(onChange).toHaveBeenCalledWith([])
  })

  it('hides select-all checkbox when searching', async () => {
    const user = userEvent.setup()
    render(<CheckboxList options={options} />)
    await user.type(getSearchInput(), 'app')
    expect(screen.queryByRole('checkbox', { name: selectAllName })).not.toBeInTheDocument()
  })

  it('selects options when checkbox is clicked', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<CheckboxList options={options} value={[]} onChange={onChange} showSelectAll={false} />)

    const selectOption = screen.getByRole('checkbox', { name: 'Option 1' })
    await user.click(selectOption)
    expect(onChange).toHaveBeenCalledWith(['option1'])
  })

  it('deselects options when checkbox is clicked when selected', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <CheckboxList
        options={options}
        value={['option1']}
        onChange={onChange}
        showSelectAll={false}
      />,
    )

    const selectOption = screen.getByRole('checkbox', { name: 'Option 1' })
    await user.click(selectOption)
    expect(onChange).toHaveBeenCalledWith([])
  })

  it('does not select options when checkbox is clicked', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<CheckboxList options={options} value={[]} onChange={onChange} disabled />)

    const selectOption = screen.getByRole('checkbox', { name: 'Option 1' })
    await user.click(selectOption)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('Reset button works', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<CheckboxList options={options} value={[]} onChange={onChange} />)

    const input = getSearchInput()
    await user.type(input, 'ban')
    await user.click(screen.getByText('common.operation.resetKeywords'))
    expect(input).toHaveValue('')
    expect(screen.getByRole('checkbox', { name: 'Apple' })).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not toggle disabled option when clicked', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const disabledOptions = [
      { label: 'Enabled', value: 'enabled' },
      { label: 'Disabled', value: 'disabled', disabled: true },
    ]

    render(<CheckboxList options={disabledOptions} value={[]} onChange={onChange} />)

    const disabledCheckbox = screen.getByRole('checkbox', { name: 'Disabled' })
    await user.click(disabledCheckbox)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('renders with label prop', () => {
    render(<CheckboxList options={options} label="Test Label" />)
    expect(screen.getByText('Test Label'))!.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Test Label' }))!.toBeInTheDocument()
  })

  it('renders without showSelectAll, showCount, showSearch', () => {
    render(
      <CheckboxList options={options} showSelectAll={false} showCount={false} showSearch={false} />,
    )
    expect(screen.queryByRole('checkbox', { name: selectAllName })).not.toBeInTheDocument()
    options.forEach((option) => {
      expect(screen.getByText(option.label))!.toBeInTheDocument()
    })
  })

  it('shows indeterminate state when some options are selected', async () => {
    const user = userEvent.setup()
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
    const selectAll = screen.getByRole('checkbox', { name: selectAllName })
    expect(selectAll)!.toBeInTheDocument()
    expect(selectAll)!.toHaveAttribute('aria-checked', 'mixed')

    await user.click(selectAll)
    expect(onChange).toHaveBeenCalledWith(['option1', 'option2', 'option3', 'apple'])
  })

  it('shows no data message when no options match search', async () => {
    const user = userEvent.setup()
    render(<CheckboxList options={options} />)

    const input = getSearchInput()
    await user.type(input, 'xyz')

    expect(screen.getByText(/common.operation.noSearchResults/i))!.toBeInTheDocument()
  })

  it('does not toggle when clicking disabled option row', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const disabledOptions = [{ label: 'Option 1', value: 'option1', disabled: true }]

    render(<CheckboxList options={disabledOptions} value={[]} onChange={onChange} />)

    await user.click(screen.getByText('Option 1'))

    expect(onChange).not.toHaveBeenCalled()
  })

  it('shows correct filtered count message when searching', async () => {
    const user = userEvent.setup()
    render(<CheckboxList options={options} title="Items" />)

    const input = getSearchInput()
    await user.type(input, 'opt')

    expect(screen.getByText(/operation.searchCount/i)).toHaveTextContent('3')
  })

  it('shows no data message when no options are provided', () => {
    render(<CheckboxList options={[]} />)
    expect(screen.getByText('common.noData'))!.toBeInTheDocument()
  })
})
