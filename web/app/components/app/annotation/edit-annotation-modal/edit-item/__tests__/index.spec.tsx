import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import EditItem, { EditItemType } from '../index'

const defaultProps = {
  type: EditItemType.Query,
  content: 'Original content',
  onSave: vi.fn(),
}

const startEditing = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByText('common.operation.edit'))
  return screen.getByRole('textbox')
}

describe('EditItem', () => {
  beforeEach(() => vi.clearAllMocks())

  it('does not offer editing in readonly mode', () => {
    render(<EditItem {...defaultProps} readonly />)

    expect(screen.queryByText('common.operation.edit')).not.toBeInTheDocument()
  })

  it('cancels editing without saving', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<EditItem {...defaultProps} onSave={onSave} />)

    const textbox = await startEditing(user)
    await user.clear(textbox)
    await user.type(textbox, 'Discarded draft')
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getByText('Original content')).toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('can restore the original content after saving an edit', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<EditItem {...defaultProps} onSave={onSave} />)

    const textbox = await startEditing(user)
    await user.clear(textbox)
    await user.type(textbox, 'Updated content')
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    await user.click(await screen.findByText('common.operation.delete'))

    expect(onSave).toHaveBeenNthCalledWith(1, 'Updated content')
    expect(onSave).toHaveBeenNthCalledWith(2, 'Original content')
  })

  it('keeps editing available when saving fails', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockRejectedValue(new Error('Save failed'))
    render(<EditItem {...defaultProps} onSave={onSave} />)

    const textbox = await startEditing(user)
    await user.type(textbox, 'Updated content')
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(onSave).toHaveBeenCalledWith('Updated content')
    expect(screen.getByRole('textbox')).toHaveValue('Updated content')
    expect(screen.getByRole('button', { name: 'common.operation.save' })).toBeInTheDocument()
  })
})
