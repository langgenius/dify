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
      <button type="button" onClick={() => setList([...list].reverse())}>
        reorder-options
      </button>
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

  it('gives each option input a localized accessible name', () => {
    render(<ConfigSelect {...defaultProps} />)

    defaultProps.options.forEach((option, index) => {
      expect(
        screen.getByRole('textbox', {
          name: `appDebug.variableConfig.options ${index + 1}`,
        }),
      ).toHaveValue(option)
    })
  })

  it('associates option errors with the inputs and clears them when corrected', () => {
    const { rerender } = render(
      <>
        <ConfigSelect {...defaultProps} errorMessage="Duplicate options" errorId="options-error" />
        <p id="options-error">Duplicate options</p>
      </>,
    )

    screen.getAllByRole('textbox').forEach((input) => {
      expect(input).toHaveAttribute('aria-invalid', 'true')
      expect(input).toHaveAccessibleDescription('Duplicate options')
    })
    expect(
      screen.getByRole('button', {
        name: 'appDebug.variableConfig.addOption',
      }),
    ).not.toHaveAttribute('aria-invalid')

    rerender(<ConfigSelect {...defaultProps} />)

    screen.getAllByRole('textbox').forEach((input) => {
      expect(input).not.toHaveAttribute('aria-invalid')
      expect(input).not.toHaveAttribute('aria-describedby')
    })
  })

  it('associates the empty-list error with the focusable add action', async () => {
    const user = userEvent.setup()
    render(
      <>
        <ConfigSelect
          options={[]}
          onChange={defaultProps.onChange}
          errorMessage="Add at least one option"
          errorId="options-error"
        />
        <p id="options-error">Add at least one option</p>
      </>,
    )

    const addOption = screen.getByRole('button', { name: 'appDebug.variableConfig.addOption' })
    await user.tab()

    expect(addOption).toHaveFocus()
    expect(addOption).toHaveAttribute('aria-invalid', 'true')
    expect(addOption).toHaveAccessibleDescription('Add at least one option')
  })

  it('handles option deletion', () => {
    render(<ConfigSelect {...defaultProps} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'common.operation.delete' })[0]!)
    expect(defaultProps.onChange).toHaveBeenCalledWith(['Option 2'])
  })

  it.each(['{Enter}', ' '])(
    'adds an option with %s without submitting the enclosing form',
    async (key) => {
      const user = userEvent.setup()
      const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault())
      render(
        <form onSubmit={onSubmit}>
          <ConfigSelect options={[]} onChange={defaultProps.onChange} />
        </form>,
      )
      await user.tab()
      expect(
        screen.getByRole('button', { name: 'appDebug.variableConfig.addOption' }),
      ).toHaveFocus()
      await user.keyboard(key)
      expect(defaultProps.onChange).toHaveBeenCalledExactlyOnceWith([''])
      expect(onSubmit).not.toHaveBeenCalled()
    },
  )

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
