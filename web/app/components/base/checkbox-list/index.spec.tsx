/* eslint-disable next/no-img-element */
import type { ImgHTMLAttributes } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CheckboxList from '.'

vi.mock('next/image', () => ({
  default: (props: ImgHTMLAttributes<HTMLImageElement>) => <img {...props} />,
}))

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
})
