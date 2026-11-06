import type { MetadataItemWithEdit } from '../../types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vite-plus/test'
import { DataType } from '../../types'
import AddRow from '../add-row'

const payload: MetadataItemWithEdit = {
  id: 'author-id',
  name: 'author',
  type: DataType.string,
  value: 'Alice',
}

it('lets keyboard users remove a pending field', async () => {
  const user = userEvent.setup()
  const onRemove = vi.fn()
  render(<AddRow payload={payload} onChange={vi.fn()} onRemove={onRemove} />)

  await user.tab()
  await user.tab()
  expect(screen.getByRole('button', { name: 'common.operation.remove author' })).toHaveFocus()
  await user.keyboard(' ')
  expect(onRemove).toHaveBeenCalledOnce()
})

it('preserves the field identity when its value changes', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(<AddRow payload={payload} onChange={onChange} onRemove={vi.fn()} />)

  await user.type(screen.getByRole('textbox', { name: 'author' }), '!')

  expect(onChange).toHaveBeenLastCalledWith({
    id: 'author-id',
    name: 'author',
    type: DataType.string,
    value: 'Alice!',
  })
})
