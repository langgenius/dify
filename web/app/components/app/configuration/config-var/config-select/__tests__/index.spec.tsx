import { fireEvent, render, screen } from '@testing-library/react'
import ConfigSelect from '../index'

vi.mock('react-sortablejs', () => ({
  ReactSortable: ({
    children,
    list,
    setList,
  }: {
    children: React.ReactNode
    list: Array<{ id: number, name: string }>
    setList: (list: Array<{ id: number, name: string }>) => void
  }) => (
    <div>
      <button onClick={() => setList([...list].reverse())}>reorder-options</button>
      {children}
    </div>
  ),
}))

describe('ConfigSelect Component', () => {
  const defaultProps = {
    options: ['Option 1', 'Option 2'],
    onChange: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders all options', () => {
    render(<ConfigSelect {...defaultProps} />)

    defaultProps.options.forEach((option) => {
      expect(screen.getByDisplayValue(option)).toBeInTheDocument()
    })
  })

  it('renders add button', () => {
    render(<ConfigSelect {...defaultProps} />)

    expect(screen.getByText('appDebug.variableConfig.addOption')).toBeInTheDocument()
  })

  it('handles option deletion', () => {
    render(<ConfigSelect {...defaultProps} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'common.operation.delete' })[0]!)
    expect(defaultProps.onChange).toHaveBeenCalledWith(['Option 2'])
  })

  it('handles adding new option', () => {
    render(<ConfigSelect {...defaultProps} />)
    const addButton = screen.getByText('appDebug.variableConfig.addOption')

    fireEvent.click(addButton)

    expect(defaultProps.onChange).toHaveBeenCalledWith([...defaultProps.options, ''])
  })

  it('applies focus styles on input focus', () => {
    render(<ConfigSelect {...defaultProps} />)
    const firstInput = screen.getByDisplayValue('Option 1')

    fireEvent.focus(firstInput)

    expect(firstInput.closest('div')).toHaveClass('border-components-input-border-active')
  })

  it('updates option values and clears focus styles on blur', () => {
    render(<ConfigSelect {...defaultProps} />)
    const firstInput = screen.getByDisplayValue('Option 1')

    fireEvent.change(firstInput, { target: { value: 'Updated option' } })
    expect(defaultProps.onChange).toHaveBeenCalledWith(['Updated option', 'Option 2'])

    fireEvent.focus(firstInput)
    fireEvent.blur(firstInput)
    expect(firstInput.closest('div')).not.toHaveClass('border-components-input-border-active')
  })

  it('applies delete hover styles', () => {
    render(<ConfigSelect {...defaultProps} />)
    const optionContainer = screen.getByDisplayValue('Option 1').closest('div')
    const deleteButton = screen.getAllByRole('button', { name: 'common.operation.delete' })[0]

    if (!deleteButton)
      return
    fireEvent.mouseEnter(deleteButton)
    expect(optionContainer).toHaveClass('border-components-input-border-destructive')
    fireEvent.mouseLeave(deleteButton)
    expect(optionContainer).not.toHaveClass('border-components-input-border-destructive')
  })

  it('renders empty state correctly', () => {
    render(<ConfigSelect options={[]} onChange={defaultProps.onChange} />)

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getByText('appDebug.variableConfig.addOption')).toBeInTheDocument()
  })

  it('reorders options through the sortable callback', () => {
    render(<ConfigSelect {...defaultProps} />)

    fireEvent.click(screen.getByText('reorder-options'))

    expect(defaultProps.onChange).toHaveBeenCalledWith(['Option 2', 'Option 1'])
  })
})
