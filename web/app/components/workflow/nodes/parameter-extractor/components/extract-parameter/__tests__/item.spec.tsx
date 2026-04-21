import { fireEvent, render, screen } from '@testing-library/react'
import { ParamType } from '../../../types'
import Item from '../item'

describe('parameter-extractor/extract-parameter/item', () => {
  it('renders parameter details and forwards edit and delete actions', () => {
    const handleEdit = vi.fn()
    const handleDelete = vi.fn()
    const { container } = render(
      <Item
        payload={{
          name: 'city',
          type: ParamType.string,
          description: 'City name',
          required: true,
        }}
        onEdit={handleEdit}
        onDelete={handleDelete}
      />,
    )

    expect(screen.getByText('city')).toBeInTheDocument()
    expect(screen.getByText(ParamType.string)).toBeInTheDocument()
    expect(screen.getByText('City name')).toBeInTheDocument()
    expect(screen.getByText('workflow.nodes.parameterExtractor.addExtractParameterContent.required')).toBeInTheDocument()

    const actionButtons = container.querySelectorAll('.cursor-pointer.rounded-md.p-1')
    fireEvent.click(actionButtons[0] as HTMLElement)
    fireEvent.click(actionButtons[1] as HTMLElement)

    expect(handleEdit).toHaveBeenCalledTimes(1)
    expect(handleDelete).toHaveBeenCalledTimes(1)
  })
})
