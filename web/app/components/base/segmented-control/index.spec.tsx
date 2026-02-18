import { fireEvent, render, screen } from '@testing-library/react'
import SegmentedControl from './index'

describe('SegmentedControl', () => {
  const options = [
    { value: 'option1', text: 'Option 1' },
    { value: 'option2', text: 'Option 2' },
    { value: 'option3', text: 'Option 3' },
  ]

  const optionsWithDisabled = [
    { value: 'option1', text: 'Option 1' },
    { value: 'option2', text: 'Option 2', disabled: true },
    { value: 'option3', text: 'Option 3' },
  ]

  const onSelectMock = vi.fn((value: string | number | symbol) => value)

  beforeEach(() => {
    onSelectMock.mockClear()
  })

  it('renders all options correctly', () => {
    render(<SegmentedControl options={options} value="option1" onChange={onSelectMock} />)

    options.forEach((option) => {
      expect(screen.getByText(option.text)).toBeInTheDocument()
    })

    const divider = screen.getByTestId('segmented-control-divider-1')
    expect(divider).toBeInTheDocument()
  })

  it('renders with custom activeClassName when provided', () => {
    render(
      <SegmentedControl
        options={options}
        value="option1"
        onChange={onSelectMock}
        activeClassName="custom-active-class"
      />,
    )

    const selectedOption = screen.getByText('Option 1').closest('button')
    expect(selectedOption).toHaveClass('custom-active-class')
  })

  it('highlights the selected option', () => {
    render(<SegmentedControl options={options} value="option2" onChange={onSelectMock} />)

    const selectedOption = screen.getByText('Option 2').closest('button')
    expect(selectedOption).toHaveClass('active')
  })

  it('calls onChange when an option is clicked', () => {
    render(<SegmentedControl options={options} value="option1" onChange={onSelectMock} />)

    fireEvent.click(screen.getByText('Option 3'))
    expect(onSelectMock).toHaveBeenCalledWith('option3')
  })

  it('does not call onChange when clicking the already selected option', () => {
    render(<SegmentedControl options={options} value="option1" onChange={onSelectMock} />)

    fireEvent.click(screen.getByText('Option 1'))
    expect(onSelectMock).not.toHaveBeenCalled()
  })

  it('handles disabled state correctly', () => {
    render(<SegmentedControl options={optionsWithDisabled} value="option1" onChange={onSelectMock} />)

    fireEvent.click(screen.getByText('Option 2'))
    expect(onSelectMock).not.toHaveBeenCalled()

    const optionElement = screen.getByText('Option 2').closest('button')
    expect(optionElement).toHaveAttribute('disabled')
    expect(optionElement).toHaveClass('disabled')

    fireEvent.click(screen.getByText('Option 3'))
    expect(onSelectMock).toHaveBeenCalledWith('option3')
  })

  it('renders with custom className when provided', () => {
    const customClass = 'my-custom-class'
    render(
      <SegmentedControl
        options={options}
        value="option1"
        onChange={onSelectMock}
        className={customClass}
      />,
    )

    const selectedOption = screen.getByText('Option 1').closest('button')?.closest('div')
    expect(selectedOption).toHaveClass(customClass)
  })
})
