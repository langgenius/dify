import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import VarItem from '../var-item'

describe('VarItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render variable metadata and required badge', () => {
    render(
      <VarItem
        label="Customer Name"
        name="customer_name"
        onEdit={vi.fn()}
        onRemove={vi.fn()}
        required
        type="string"
      />,
    )

    expect(screen.getByTitle('customer_name · Customer Name')).toBeInTheDocument()
    expect(screen.getByText('required')).toBeInTheDocument()
    expect(screen.getByText('string')).toBeInTheDocument()
  })

  it('should trigger edit and remove callbacks', () => {
    const onEdit = vi.fn()
    const onRemove = vi.fn()

    const { container } = render(
      <VarItem
        label="Customer Name"
        name="customer_name"
        onEdit={onEdit}
        onRemove={onRemove}
        required={false}
        type="string"
      />,
    )

    const actionButtons = container.querySelectorAll('div.h-6.w-6')
    fireEvent.click(actionButtons[0])
    fireEvent.click(screen.getByTestId('var-item-delete-btn'))

    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onRemove).toHaveBeenCalledTimes(1)
  })

  it('should highlight destructive state while hovering the delete action', () => {
    const { container } = render(
      <VarItem
        label="Customer Name"
        name="customer_name"
        onEdit={vi.fn()}
        onRemove={vi.fn()}
        required={false}
        type="string"
      />,
    )

    const item = container.firstElementChild as HTMLElement
    const deleteButton = screen.getByTestId('var-item-delete-btn')

    fireEvent.mouseOver(deleteButton)
    expect(item.className).toContain('border-state-destructive-border')

    fireEvent.mouseLeave(deleteButton)
    expect(item.className).not.toContain('border-state-destructive-border')
  })
})
