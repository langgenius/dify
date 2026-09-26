import { detectPlatform } from '@tanstack/react-hotkeys'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReactFlowProvider } from 'reactflow'
import Operator from '../operator'

const renderOperator = (showAuthor = false) => {
  const onCopy = vi.fn()
  const onDuplicate = vi.fn()
  const onDelete = vi.fn()
  const onShowAuthorChange = vi.fn()

  render(
    <ReactFlowProvider>
      <Operator
        onCopy={onCopy}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
        showAuthor={showAuthor}
        onShowAuthorChange={onShowAuthorChange}
      />
    </ReactFlowProvider>,
  )

  return {
    onCopy,
    onDelete,
    onDuplicate,
    onShowAuthorChange,
  }
}

describe('NoteEditor Toolbar Operator', () => {
  it.each(['c', 'd', 'Delete'])('runs %s from its focused note menu', async (key) => {
    const user = userEvent.setup()
    const { onCopy, onDuplicate, onDelete } = renderOperator()
    await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
    const item = screen.getByRole('menuitem', { name: /workflow.common.copy/ })
    act(() => item.focus())
    const mod = detectPlatform() === 'mac' ? 'Meta' : 'Control'
    await user.keyboard(key.length === 1 ? `{${mod}>}${key}{/${mod}}` : `{${key}}`)
    const action = key === 'c' ? onCopy : key === 'd' ? onDuplicate : onDelete
    expect(action).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

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
    renderOperator(true)

    await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
    await user.click(screen.getByRole('switch'))

    expect(screen.getByText('workflow.nodes.note.editor.showAuthor')).toBeInTheDocument()
  })
})
