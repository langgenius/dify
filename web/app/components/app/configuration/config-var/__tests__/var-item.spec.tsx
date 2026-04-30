import { fireEvent, render, screen } from '@testing-library/react'
import VarItem from '../var-item'

describe('VarItem', () => {
  it('should render variable metadata and allow editing', () => {
    const onEdit = vi.fn()
    const onRemove = vi.fn()
    const { container } = render(
      <VarItem
        canDrag
        name="api_key"
        label="API Key"
        required
        type="string"
        onEdit={onEdit}
        onRemove={onRemove}
      />,
    )

    expect(screen.getByTitle('api_key · API Key')).toBeInTheDocument()
    expect(screen.getByText('required')).toBeInTheDocument()

    const editButton = container.querySelector('.mr-1.flex.h-6.w-6') as HTMLElement
    fireEvent.click(editButton)

    expect(onEdit).toHaveBeenCalledTimes(1)
  })

  it('should call remove when clicking the delete action', () => {
    const onRemove = vi.fn()
    render(
      <VarItem
        name="region"
        label="Region"
        required={false}
        type="select"
        onEdit={vi.fn()}
        onRemove={onRemove}
      />,
    )

    fireEvent.click(screen.getByTestId('var-item-delete-btn'))

    expect(onRemove).toHaveBeenCalledTimes(1)
  })
})
