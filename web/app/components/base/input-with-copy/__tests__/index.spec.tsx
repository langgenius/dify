import { fireEvent, render, screen } from '@testing-library/react'
import InputWithCopy from '../index'

// Create a controllable mock for useClipboard
const mockCopy = vi.fn()
let mockCopied = false
const mockReset = vi.fn()

vi.mock('foxact/use-clipboard', () => ({
  useClipboard: () => ({
    copy: mockCopy,
    copied: mockCopied,
    reset: mockReset,
  }),
}))

describe('InputWithCopy component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCopy.mockClear()
    mockReset.mockClear()
    mockCopied = false
  })

  it('renders correctly with default props', () => {
    const mockOnChange = vi.fn()
    render(<InputWithCopy value="test value" onChange={mockOnChange} />)
    const input = screen.getByDisplayValue('test value')
    const copyButton = screen.getByRole('button')
    expect(input).toBeInTheDocument()
    expect(copyButton).toBeInTheDocument()
  })

  it('hides copy button when showCopyButton is false', () => {
    const mockOnChange = vi.fn()
    render(<InputWithCopy value="test value" onChange={mockOnChange} showCopyButton={false} />)
    const input = screen.getByDisplayValue('test value')
    const copyButton = screen.queryByRole('button')
    expect(input).toBeInTheDocument()
    expect(copyButton).not.toBeInTheDocument()
  })

  it('calls copy function with input value when copy button is clicked', () => {
    const mockOnChange = vi.fn()
    render(<InputWithCopy value="test value" onChange={mockOnChange} />)

    const copyButton = screen.getByRole('button')
    fireEvent.click(copyButton)

    expect(mockCopy).toHaveBeenCalledWith('test value')
  })

  it('calls copy function with custom value when copyValue prop is provided', () => {
    const mockOnChange = vi.fn()
    render(<InputWithCopy value="display value" onChange={mockOnChange} copyValue="custom copy value" />)

    const copyButton = screen.getByRole('button')
    fireEvent.click(copyButton)

    expect(mockCopy).toHaveBeenCalledWith('custom copy value')
  })

  it('calls onCopy callback when copy button is clicked', () => {
    const onCopyMock = vi.fn()
    const mockOnChange = vi.fn()
    render(<InputWithCopy value="test value" onChange={mockOnChange} onCopy={onCopyMock} />)

    const copyButton = screen.getByRole('button')
    fireEvent.click(copyButton)

    expect(onCopyMock).toHaveBeenCalledWith('test value')
  })

  it('shows copied state when copied is true', () => {
    mockCopied = true
    const mockOnChange = vi.fn()
    render(<InputWithCopy value="test value" onChange={mockOnChange} />)

    const copyButton = screen.getByRole('button')
    // Hover over the button to trigger tooltip
    fireEvent.mouseEnter(copyButton)

    // The icon should change to filled version when copied
    // We verify the component renders without error in copied state
    expect(copyButton).toBeInTheDocument()
  })

  it('passes through all input props correctly', () => {
    const mockOnChange = vi.fn()
    render(
      <InputWithCopy
        value="test value"
        onChange={mockOnChange}
        placeholder="Custom placeholder"
        disabled
        readOnly
        className="custom-class"
      />,
    )

    const input = screen.getByDisplayValue('test value')
    expect(input).toHaveAttribute('placeholder', 'Custom placeholder')
    expect(input).toBeDisabled()
    expect(input).toHaveAttribute('readonly')
    expect(input).toHaveClass('custom-class')
  })

  it('handles empty value correctly', () => {
    const mockOnChange = vi.fn()
    render(<InputWithCopy value="" onChange={mockOnChange} />)
    const input = screen.getByRole('textbox')
    const copyButton = screen.getByRole('button')

    expect(input).toBeInTheDocument()
    expect(input).toHaveValue('')
    expect(copyButton).toBeInTheDocument()

    // Clicking copy button with empty value should call copy with empty string
    fireEvent.click(copyButton)
    expect(mockCopy).toHaveBeenCalledWith('')
  })

  it('maintains focus on input after copy', () => {
    const mockOnChange = vi.fn()
    render(<InputWithCopy value="test value" onChange={mockOnChange} />)

    const input = screen.getByDisplayValue('test value')
    const copyButton = screen.getByRole('button')

    input.focus()
    expect(input).toHaveFocus()

    fireEvent.click(copyButton)

    // Input should maintain focus after copy
    expect(input).toHaveFocus()
  })

  it('converts non-string value to string for copying', () => {
    const mockOnChange = vi.fn()
    // number value triggers String(value || '') branch where typeof value !== 'string'
    render(<InputWithCopy value={12345} onChange={mockOnChange} />)

    const copyButton = screen.getByRole('button')
    fireEvent.click(copyButton)

    expect(mockCopy).toHaveBeenCalledWith('12345')
  })

  it('handles undefined value by converting to empty string', () => {
    const mockOnChange = vi.fn()
    // undefined value triggers String(value || '') where value is falsy
    render(<InputWithCopy value={undefined} onChange={mockOnChange} />)

    const copyButton = screen.getByRole('button')
    fireEvent.click(copyButton)

    expect(mockCopy).toHaveBeenCalledWith('')
  })

  it('shows copied tooltip text when copied state is true', () => {
    mockCopied = true
    const mockOnChange = vi.fn()
    render(<InputWithCopy value="test value" onChange={mockOnChange} />)

    // The tooltip content should use the 'copied' translation
    const copyButton = screen.getByRole('button')
    expect(copyButton).toBeInTheDocument()

    // Verify the filled clipboard icon is rendered (not the line variant)
    const filledIcon = screen.getByTestId('copied-icon')
    expect(filledIcon).toBeInTheDocument()
  })

  it('shows copy tooltip text when copied state is false', () => {
    mockCopied = false
    const mockOnChange = vi.fn()
    render(<InputWithCopy value="test value" onChange={mockOnChange} />)

    const copyButton = screen.getByRole('button')
    expect(copyButton).toBeInTheDocument()

    const lineIcon = screen.getByTestId('copy-icon')
    expect(lineIcon).toBeInTheDocument()
  })

  it('calls reset on mouse leave from copy button wrapper', () => {
    const mockOnChange = vi.fn()
    render(<InputWithCopy value="test value" onChange={mockOnChange} />)

    const wrapper = screen.getByTestId('copy-button-wrapper')
    expect(wrapper).toBeInTheDocument()
    fireEvent.mouseLeave(wrapper)

    expect(mockReset).toHaveBeenCalled()
  })

  it('applies wrapperClassName to the outer container', () => {
    const mockOnChange = vi.fn()
    const { container } = render(
      <InputWithCopy value="test" onChange={mockOnChange} wrapperClassName="my-wrapper" />,
    )

    const outerDiv = container.firstChild as HTMLElement
    expect(outerDiv).toHaveClass('my-wrapper')
  })

  it('copies copyValue over non-string input value when both provided', () => {
    const mockOnChange = vi.fn()
    render(
      <InputWithCopy value={42} onChange={mockOnChange} copyValue="override-copy" />,
    )

    const copyButton = screen.getByRole('button')
    fireEvent.click(copyButton)

    expect(mockCopy).toHaveBeenCalledWith('override-copy')
  })

  it('invokes onCopy with copyValue when copyValue is provided', () => {
    const onCopyMock = vi.fn()
    const mockOnChange = vi.fn()
    render(
      <InputWithCopy value="display" onChange={mockOnChange} copyValue="custom" onCopy={onCopyMock} />,
    )

    const copyButton = screen.getByRole('button')
    fireEvent.click(copyButton)

    expect(onCopyMock).toHaveBeenCalledWith('custom')
  })
})
