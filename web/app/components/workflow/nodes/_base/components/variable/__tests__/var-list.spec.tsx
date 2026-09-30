import type { Variable } from '@/app/components/workflow/types'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { VarType } from '@/app/components/workflow/types'
import VarList from '../var-list'

vi.mock('../var-reference-picker', () => ({
  default: () => <button type="button">Variable value</button>,
}))

describe('VarList', () => {
  it('normalizes a variable name through its labeled input', () => {
    const onChange = vi.fn()

    render(
      <VarList
        nodeId="node-id"
        readonly={false}
        list={[
          {
            variable: 'input',
            value_selector: ['node-id', 'value'],
            value_type: VarType.string,
          },
        ]}
        onChange={onChange}
      />,
    )

    fireEvent.change(
      screen.getByRole('textbox', { name: 'workflow.common.variableNamePlaceholder' }),
      { target: { value: 'renamed input' } },
    )

    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ variable: 'renamed_input' })])
  })
})

const initialVariables: Variable[] = ['alpha', 'beta', 'gamma'].map((variable) => ({
  variable,
  value_selector: ['node-id', variable],
  value_type: VarType.string,
}))

function SortableVariables({
  onChange,
  readonly = false,
}: {
  onChange: (items: Variable[]) => void
  readonly?: boolean
}) {
  const [variables, setVariables] = useState(initialVariables)
  return (
    <VarList
      nodeId="node-id"
      readonly={readonly}
      list={variables}
      onChange={(items) => {
        onChange(items)
        setVariables(items)
      }}
    />
  )
}

it('tabs through each variable from the reorder handle to its name, value and remove button', async () => {
  const user = userEvent.setup()
  render(<SortableVariables onChange={vi.fn()} />)
  const handles = screen.getAllByRole('button', { pressed: false })
  const names = screen.getAllByRole('textbox')
  const values = screen.getAllByRole('button', { name: 'Variable value' })
  const removeButtons = screen.getAllByRole('button', { name: 'common.operation.remove' })

  for (let index = 0; index < initialVariables.length; index++) {
    for (const control of [handles[index], names[index], values[index], removeButtons[index]]) {
      await user.tab()
      expect(control).toHaveFocus()
    }
  }

  await user.tab({ shift: true })
  expect(values[2]).toHaveFocus()
  await user.tab({ shift: true })
  expect(names[2]).toHaveFocus()
  await user.tab({ shift: true })
  expect(handles[2]).toHaveFocus()
})

it('previews variable ordering, commits only on confirmation, and keeps the moved handle focused', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(<SortableVariables onChange={onChange} />)
  expect(onChange).not.toHaveBeenCalled()
  const handle = screen.getAllByRole('button', { pressed: false })[0]!
  await user.tab()
  expect(handle).toHaveFocus()
  await user.keyboard('{Enter}{ArrowDown}')
  expect(screen.getAllByRole('textbox').map((input) => (input as HTMLInputElement).value)).toEqual([
    'beta',
    'alpha',
    'gamma',
  ])
  expect(onChange).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { pressed: true })).toHaveFocus()
  await user.keyboard('{Enter}')
  expect(onChange).toHaveBeenCalledExactlyOnceWith([
    initialVariables[1],
    initialVariables[0],
    initialVariables[2],
  ])
  expect(screen.getAllByRole('button', { pressed: false })[1]).toHaveFocus()
})

it('cancels a variable reorder and leaves arrow keys inside name inputs available for editing', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(<SortableVariables onChange={onChange} />)
  await user.tab()
  await user.tab()
  expect(screen.getAllByRole('textbox')[0]).toHaveFocus()
  await user.keyboard('{ArrowDown}')
  expect(onChange).not.toHaveBeenCalled()
  const handle = screen.getAllByRole('button', { pressed: false })[0]!
  await user.tab({ shift: true })
  expect(handle).toHaveFocus()
  await user.keyboard(' {ArrowDown}{Escape}')
  expect(screen.getAllByRole('textbox').map((input) => (input as HTMLInputElement).value)).toEqual([
    'alpha',
    'beta',
    'gamma',
  ])
  expect(onChange).not.toHaveBeenCalled()
  expect(handle).toHaveFocus()
})

it('does not expose variable sorting in readonly mode', () => {
  render(<SortableVariables onChange={vi.fn()} readonly />)
  expect(screen.queryByRole('button', { pressed: false })).not.toBeInTheDocument()
})

it('cancels a preview before deleting the variable whose remove button was activated', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(<SortableVariables onChange={onChange} />)
  const handle = screen.getAllByRole('button', { pressed: false })[0]!
  await user.tab()
  expect(handle).toHaveFocus()
  await user.keyboard('{Enter}{ArrowDown}')
  await user.click(screen.getAllByRole('button', { name: 'common.operation.remove' })[1]!)
  expect(onChange).toHaveBeenCalledExactlyOnceWith([initialVariables[1], initialVariables[2]])
  expect(screen.getAllByRole('textbox').map((input) => (input as HTMLInputElement).value)).toEqual([
    'beta',
    'gamma',
  ])
})
