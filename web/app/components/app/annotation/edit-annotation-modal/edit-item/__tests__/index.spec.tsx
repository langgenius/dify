import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import EditItem, { EditItemType, EditTitle } from '../index'

const defaultProps = {
  type: EditItemType.Query,
  content: 'Original content',
  onSave: vi.fn(),
}

const startEditing = async () => {
  await userEvent.click(screen.getByText('common.operation.edit'))
  return screen.getByRole('textbox')
}

describe('EditTitle', () => {
  it('shows the field title', () => {
    render(<EditTitle title="Query" />)

    expect(screen.getByText('Query')).toBeInTheDocument()
  })
})

describe('EditItem', () => {
  beforeEach(() => vi.clearAllMocks())

  it('does not offer editing in readonly mode', () => {
    render(<EditItem {...defaultProps} readonly />)

    expect(screen.queryByText('common.operation.edit')).not.toBeInTheDocument()
  })

  it('saves updated content', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<EditItem {...defaultProps} onSave={onSave} />)

    const textbox = await startEditing()
    await userEvent.clear(textbox)
    await userEvent.type(textbox, 'Updated content')
    await userEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(onSave).toHaveBeenCalledWith('Updated content')
  })

  it('cancels editing without saving', async () => {
    const onSave = vi.fn()
    render(<EditItem {...defaultProps} onSave={onSave} />)

    await startEditing()
    await userEvent.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getByText('Original content')).toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('can restore the original content after saving an edit', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<EditItem {...defaultProps} onSave={onSave} />)

    const textbox = await startEditing()
    await userEvent.clear(textbox)
    await userEvent.type(textbox, 'Updated content')
    await userEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))
    await userEvent.click(await screen.findByText('common.operation.delete'))

    expect(onSave).toHaveBeenNthCalledWith(1, 'Updated content')
    expect(onSave).toHaveBeenNthCalledWith(2, 'Original content')
  })

  it('keeps editing available when saving fails', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('Save failed'))
    render(<EditItem {...defaultProps} onSave={onSave} />)

    const textbox = await startEditing()
    await userEvent.type(textbox, ' updated')
    await userEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(screen.getByRole('textbox')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.operation.save' })).toBeInTheDocument()
  })
})
