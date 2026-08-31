import type { PropsWithChildren } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { VarType } from '@/app/components/workflow/types'
import VarList from '../var-list'

vi.mock('react-sortablejs', () => ({
  ReactSortable: ({ children }: PropsWithChildren) => <div>{children}</div>,
}))

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
