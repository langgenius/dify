import { fireEvent, render, screen } from '@testing-library/react'
import { ChatVarType } from '../../type'
import ObjectValueList from '../object-value-list'

describe('ObjectValueList', () => {
  it('renders headers and forwards child item changes', () => {
    const onChange = vi.fn()

    render(
      <ObjectValueList
        list={[{ key: 'reason', type: ChatVarType.String, value: 'draft' }]}
        onChange={onChange}
      />,
    )

    expect(screen.getByText('workflow.chatVariable.modal.objectKey')).toBeInTheDocument()
    expect(screen.getByText('workflow.chatVariable.modal.objectType')).toBeInTheDocument()
    expect(screen.getByText('workflow.chatVariable.modal.objectValue')).toBeInTheDocument()

    fireEvent.change(screen.getByDisplayValue('reason'), { target: { value: 'status' } })

    expect(onChange).toHaveBeenCalledWith([{ key: 'status', type: ChatVarType.String, value: 'draft' }])
  })
})
