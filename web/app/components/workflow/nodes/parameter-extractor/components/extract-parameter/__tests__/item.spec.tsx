import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ParamType } from '../../../types'
import Item from '../item'

describe('parameter-extractor/extract-parameter/item', () => {
  it('renders parameter details and forwards edit and delete actions', async () => {
    const user = userEvent.setup()
    const handleEdit = vi.fn()
    const handleDelete = vi.fn()
    render(
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

    await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))
    await user.click(screen.getByRole('button', { name: 'common.operation.delete' }))

    expect(handleEdit).toHaveBeenCalledTimes(1)
    expect(handleDelete).toHaveBeenCalledTimes(1)
  })
})
