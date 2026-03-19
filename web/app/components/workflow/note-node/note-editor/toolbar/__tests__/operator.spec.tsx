import { fireEvent, render, screen } from '@testing-library/react'
import Operator from '../operator'

const renderOperator = (showAuthor = false) => {
  const onCopy = vi.fn()
  const onDuplicate = vi.fn()
  const onDelete = vi.fn()
  const onShowAuthorChange = vi.fn()

  const renderResult = render(
    <Operator
      onCopy={onCopy}
      onDuplicate={onDuplicate}
      onDelete={onDelete}
      showAuthor={showAuthor}
      onShowAuthorChange={onShowAuthorChange}
    />,
  )

  return {
    ...renderResult,
    onCopy,
    onDelete,
    onDuplicate,
    onShowAuthorChange,
  }
}

describe('NoteEditor Toolbar Operator', () => {
  it('should trigger copy, duplicate, and delete from the opened menu', () => {
    const {
      container,
      onCopy,
      onDelete,
      onDuplicate,
    } = renderOperator()

    const trigger = container.querySelector('[data-state="closed"]') as HTMLElement

    fireEvent.click(trigger)
    fireEvent.click(screen.getByText('workflow.common.copy'))

    expect(onCopy).toHaveBeenCalledTimes(1)

    fireEvent.click(container.querySelector('[data-state="closed"]') as HTMLElement)
    fireEvent.click(screen.getByText('workflow.common.duplicate'))

    expect(onDuplicate).toHaveBeenCalledTimes(1)

    fireEvent.click(container.querySelector('[data-state="closed"]') as HTMLElement)
    fireEvent.click(screen.getByText('common.operation.delete'))

    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('should forward the switch state through onShowAuthorChange', () => {
    const {
      container,
      onShowAuthorChange,
    } = renderOperator(true)

    fireEvent.click(container.querySelector('[data-state="closed"]') as HTMLElement)
    fireEvent.click(screen.getByRole('switch'))

    expect(onShowAuthorChange).toHaveBeenCalledWith(false)
  })
})
