import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Operator from '../operator'

const renderOperator = (showAuthor = false) => {
  const onCopy = vi.fn()
  const onDuplicate = vi.fn()
  const onDelete = vi.fn()
  const onShowAuthorChange = vi.fn()

  render(
    <Operator
      onCopy={onCopy}
      onDuplicate={onDuplicate}
      onDelete={onDelete}
      showAuthor={showAuthor}
      onShowAuthorChange={onShowAuthorChange}
    />,
  )

  return {
    onCopy,
    onDelete,
    onDuplicate,
    onShowAuthorChange,
  }
}

describe('NoteEditor Toolbar Operator', () => {
  it('triggers copy, duplicate, and delete from the opened menu', async () => {
    const user = userEvent.setup()
    const { onCopy, onDelete, onDuplicate } = renderOperator()

    await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
    await user.click(screen.getByText('workflow.common.copy'))
    expect(onCopy).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
    await user.click(screen.getByText('workflow.common.duplicate'))
    expect(onDuplicate).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
    await user.click(screen.getByText('common.operation.delete'))
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('keeps the menu open when toggling show author', async () => {
    const user = userEvent.setup()
    const { onShowAuthorChange } = renderOperator(true)

    await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
    await user.click(screen.getByRole('switch'))

    expect(onShowAuthorChange).toHaveBeenCalledWith(false)
    expect(screen.getByText('workflow.nodes.note.editor.showAuthor')).toBeInTheDocument()
  })
})
