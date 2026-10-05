import type { InputVar } from '@/app/components/workflow/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { InputVarType } from '@/app/components/workflow/types'
import VarItem from '../var-item'

const createPayload = (overrides: Partial<InputVar> = {}): InputVar => ({
  label: 'Query',
  variable: 'query',
  type: InputVarType.textInput,
  required: false,
  ...overrides,
})

describe('StartVarItem', () => {
  it('keeps named edit and remove actions mounted without hover', () => {
    const handleRemove = vi.fn()
    const onEdit = vi.fn()
    render(
      <VarItem
        readonly={false}
        payload={createPayload()}
        onRemove={handleRemove}
        onEdit={onEdit}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'common.operation.edit' }))
    expect(onEdit).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'common.operation.remove' }))
    expect(handleRemove).toHaveBeenCalledTimes(1)
  })
})
