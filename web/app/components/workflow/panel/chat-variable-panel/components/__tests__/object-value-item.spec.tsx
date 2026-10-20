import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { ChatVarType } from '../../type'
import ObjectValueItem from '../object-value-item'

const toastError = vi.fn()
vi.mock('@/app/notifications', () => ({
  toast: { error: (...args: unknown[]) => toastError(...args) },
}))

describe('ObjectValueItem', () => {
  it('preserves a renamed key while editing its value and appends only one draft row', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    function ObjectDraft() {
      const [list, setList] = useState([
        { key: 'reason', type: ChatVarType.String, value: 'draft' },
      ])
      return (
        <ObjectValueItem
          index={0}
          list={list}
          onChange={(value) => {
            setList(value)
            onChange(value)
          }}
        />
      )
    }
    render(<ObjectDraft />)

    await user.type(screen.getByDisplayValue('reason'), '_code')
    const value = screen.getByDisplayValue('draft')
    await user.clear(value)
    await user.type(value, 'published')
    await user.tab()
    await user.click(value)

    expect(onChange).toHaveBeenLastCalledWith([
      { key: 'reason_code', type: ChatVarType.String, value: 'published' },
      { key: '', type: ChatVarType.String, value: undefined },
    ])
    expect(screen.getByDisplayValue('reason_code')).toBeInTheDocument()
    expect(value).toHaveValue('published')
  })

  it('rejects invalid object keys', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <ObjectValueItem
        index={0}
        list={[{ key: 'reason', type: ChatVarType.String, value: 'draft' }]}
        onChange={onChange}
      />,
    )

    await user.type(screen.getByDisplayValue('reason'), ' ')

    expect(toastError).toHaveBeenCalledWith('workflow.chatVariable.modal.objectKeyPatternError')
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByDisplayValue('reason')).toBeInTheDocument()
  })
})
