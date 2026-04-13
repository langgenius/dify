import { fireEvent, render, screen } from '@testing-library/react'
import { ChatVarType } from '../../type'
import ObjectValueItem, { DEFAULT_OBJECT_VALUE } from '../object-value-item'

const toastError = vi.fn()

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
  },
}))

describe('ObjectValueItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('updates key and value and appends a new row when the last value input is focused', () => {
    const onChange = vi.fn()
    const list = [{
      key: 'reason',
      type: ChatVarType.String,
      value: 'draft',
    }]

    render(
      <ObjectValueItem
        index={0}
        list={list}
        onChange={onChange}
      />,
    )

    fireEvent.change(screen.getByDisplayValue('reason'), { target: { value: 'status' } })
    fireEvent.change(screen.getByDisplayValue('draft'), { target: { value: 'published' } })
    fireEvent.focus(screen.getByDisplayValue('draft'))

    expect(onChange).toHaveBeenNthCalledWith(1, [{ key: 'status', type: ChatVarType.String, value: 'draft' }])
    expect(onChange).toHaveBeenNthCalledWith(2, [{ key: 'reason', type: ChatVarType.String, value: 'published' }])
    expect(onChange).toHaveBeenNthCalledWith(3, [{ key: 'reason', type: ChatVarType.String, value: 'draft' }, DEFAULT_OBJECT_VALUE])
  })

  it('rejects invalid object keys', () => {
    const onChange = vi.fn()

    render(
      <ObjectValueItem
        index={0}
        list={[{ key: 'reason', type: ChatVarType.String, value: 'draft' }]}
        onChange={onChange}
      />,
    )

    fireEvent.change(screen.getByDisplayValue('reason'), { target: { value: 'invalid key' } })

    expect(toastError).toHaveBeenCalledWith('workflow.chatVariable.modal.objectKeyPatternError')
    expect(onChange).not.toHaveBeenCalled()
  })
})
