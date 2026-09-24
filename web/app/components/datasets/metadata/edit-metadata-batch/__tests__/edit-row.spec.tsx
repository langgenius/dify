import type { MetadataItemWithEdit } from '../../types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vite-plus/test'
import { DataType, UpdateType } from '../../types'
import EditMetadatabatchItem from '../edit-row'

const payload: MetadataItemWithEdit = {
  id: 'author-id',
  name: 'author',
  type: DataType.string,
  value: 'Alice',
}

describe('Batch metadata row', () => {
  it('preserves the field identity when its value changes', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <EditMetadatabatchItem
        payload={payload}
        onChange={onChange}
        onRemove={vi.fn()}
        onReset={vi.fn()}
      />,
    )

    await user.type(screen.getByRole('textbox', { name: 'author' }), '!')

    expect(onChange).toHaveBeenLastCalledWith({
      id: 'author-id',
      name: 'author',
      type: DataType.string,
      value: 'Alice!',
    })
  })

  it('lets keyboard users delete a named field', async () => {
    const user = userEvent.setup()
    const onRemove = vi.fn()
    render(
      <EditMetadatabatchItem
        payload={payload}
        onChange={vi.fn()}
        onRemove={onRemove}
        onReset={vi.fn()}
      />,
    )

    await user.tab()
    await user.tab()
    expect(screen.getByRole('button', { name: 'common.operation.delete author' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(onRemove).toHaveBeenCalledWith('author-id')
  })

  it('clears multiple values from the keyboard', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <EditMetadatabatchItem
        payload={{ ...payload, isMultipleValue: true }}
        onChange={onChange}
        onRemove={vi.fn()}
        onReset={vi.fn()}
      />,
    )

    await user.tab()
    expect(screen.getByRole('button', { name: 'common.operation.clear author' })).toHaveFocus()
    await user.keyboard(' ')
    expect(onChange).toHaveBeenCalledWith({ ...payload, value: null, isMultipleValue: false })
  })

  it('allows resetting a changed field without hovering', async () => {
    const user = userEvent.setup()
    const onReset = vi.fn()
    render(
      <EditMetadatabatchItem
        payload={{ ...payload, isUpdated: true }}
        onChange={vi.fn()}
        onRemove={vi.fn()}
        onReset={onReset}
      />,
    )

    await user.tab()
    expect(screen.getByRole('button', { name: 'common.operation.reset author' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(onReset).toHaveBeenCalledWith('author-id')
  })

  it('keeps deleted multiple values read only', () => {
    render(
      <EditMetadatabatchItem
        payload={{ ...payload, isMultipleValue: true, updateType: UpdateType.delete }}
        onChange={vi.fn()}
        onRemove={vi.fn()}
        onReset={vi.fn()}
      />,
    )
    expect(
      screen.queryByRole('button', { name: 'common.operation.clear author' }),
    ).not.toBeInTheDocument()
  })
})
