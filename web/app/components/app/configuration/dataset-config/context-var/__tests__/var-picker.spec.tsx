import type { Props } from '../var-picker'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import VarPicker from '../var-picker'

const options: Props['options'] = [
  { name: 'Variable 1', value: 'var1', type: 'string' },
  { name: 'Variable 2', value: 'var2', type: 'number' },
]

describe('VarPicker', () => {
  it('shows the selected variable', () => {
    render(<VarPicker value="var1" options={options} onChange={vi.fn()} />)
    expect(screen.getByRole('button')).toHaveTextContent('var1')
  })

  it('shows the configured empty-selection message', () => {
    render(
      <VarPicker
        value={undefined}
        options={options}
        onChange={vi.fn()}
        notSelectedVarTip="Choose the query variable"
      />,
    )
    expect(screen.getByText('Choose the query variable')).toBeInTheDocument()
  })

  it('selects a variable and closes the options', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<VarPicker value="var1" options={options} onChange={onChange} />)

    await user.click(screen.getByRole('button'))
    await user.click(screen.getByText('var2'))

    expect(onChange).toHaveBeenCalledWith('var2')
    expect(screen.queryByText('var2')).not.toBeInTheDocument()
  })

  it('shows the empty state when no variables are available', async () => {
    const user = userEvent.setup()
    render(<VarPicker value={undefined} options={[]} onChange={vi.fn()} />)
    await user.click(screen.getByRole('button'))
    expect(screen.getByText('appDebug.feature.dataSet.queryVariable.noVar')).toBeInTheDocument()
  })
})
