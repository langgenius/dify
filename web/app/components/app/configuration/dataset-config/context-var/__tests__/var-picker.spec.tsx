import type { ReactNode } from 'react'
import type { Props } from '../var-picker'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import VarPicker from '../var-picker'

vi.mock('@langgenius/dify-ui/popover', () => {
  const PopoverContext = React.createContext({
    open: false,
    onOpenChange: undefined as ((open: boolean) => void) | undefined,
  })

  return {
    Popover: ({
      children,
      open,
      onOpenChange,
    }: {
      children: ReactNode
      open?: boolean
      onOpenChange?: (open: boolean) => void
    }) => <PopoverContext value={{ open: !!open, onOpenChange }}>{children}</PopoverContext>,
    PopoverTrigger: ({ render }: { render?: ReactNode }) => {
      const { open, onOpenChange } = React.use(PopoverContext)
      return (
        <button type="button" aria-label="choose variable" onClick={() => onOpenChange?.(!open)}>
          {render}
        </button>
      )
    },
    PopoverContent: ({ children }: { children: ReactNode }) => {
      const { open } = React.use(PopoverContext)
      return open ? (
        <div role="dialog" aria-label="variable options">
          {children}
        </div>
      ) : null
    },
  }
})

const options: Props['options'] = [
  { name: 'Variable 1', value: 'var1', type: 'string' },
  { name: 'Variable 2', value: 'var2', type: 'number' },
]

describe('VarPicker', () => {
  it('shows the selected variable', () => {
    render(<VarPicker value="var1" options={options} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'choose variable' })).toHaveTextContent('var1')
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
    const onChange = vi.fn()
    render(<VarPicker value="var1" options={options} onChange={onChange} />)

    await userEvent.click(screen.getByRole('button', { name: 'choose variable' }))
    await userEvent.click(screen.getByText('var2'))

    expect(onChange).toHaveBeenCalledWith('var2')
    expect(screen.queryByRole('dialog', { name: 'variable options' })).not.toBeInTheDocument()
  })

  it('shows the empty state when no variables are available', async () => {
    render(<VarPicker value={undefined} options={[]} onChange={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'choose variable' }))
    expect(screen.getByText('appDebug.feature.dataSet.queryVariable.noVar')).toBeInTheDocument()
  })
})
