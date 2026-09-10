import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import ConfigSelect from '../index'

vi.mock('react-sortablejs', () => ({
  ReactSortable: ({
    children,
    list,
    setList,
  }: {
    children: React.ReactNode
    list: Array<{ id: number; name: string }>
    setList: (list: Array<{ id: number; name: string }>) => void
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

  it('updates option values and clears focus styles on blur', () => {
    render(<ConfigSelect {...defaultProps} />)
    const firstInput = screen.getByDisplayValue('Option 1')

    fireEvent.change(firstInput, { target: { value: 'Updated option' } })
    expect(defaultProps.onChange).toHaveBeenCalledWith(['Updated option', 'Option 2'])

    fireEvent.focus(firstInput)
    fireEvent.blur(firstInput)
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
  it('previews keyboard sorting and commits only when confirmed, keeping input arrows separate', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const Fixture = () => {
      const [options, setOptions] = useState(['First', 'Second', 'Third'])
      return (
        <ConfigSelect
          options={options}
          onChange={(next) => {
            onChange(next)
            setOptions(next)
          }}
        />
      )
    }
    render(<Fixture />)
    const handle = screen.getAllByRole('button', { name: /sort.handle/ })[0]!
    handle.focus()
    await user.keyboard('{Enter}{ArrowDown}')
    expect(
      screen.getAllByRole('textbox').map((input) => (input as HTMLInputElement).value),
    ).toEqual(['Second', 'First', 'Third'])
    expect(onChange).not.toHaveBeenCalled()
    expect(handle).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(onChange).toHaveBeenCalledExactlyOnceWith(['Second', 'First', 'Third'])
    await user.tab()
    expect(screen.getByDisplayValue('First')).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('cancels a keyboard reorder with duplicate options and preserves the original order', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ConfigSelect options={['Same', 'Same', 'Last']} onChange={onChange} />)
    const handle = screen.getAllByRole('button', { name: /sort.handle/ })[1]!
    handle.focus()
    await user.keyboard(' {ArrowDown}')
    expect(
      screen.getAllByRole('textbox').map((input) => (input as HTMLInputElement).value),
    ).toEqual(['Same', 'Last', 'Same'])
    expect(handle).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(
      screen.getAllByRole('textbox').map((input) => (input as HTMLInputElement).value),
    ).toEqual(['Same', 'Same', 'Last'])
    expect(onChange).not.toHaveBeenCalled()
    expect(handle).toHaveFocus()
  })
})
