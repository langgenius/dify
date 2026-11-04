import { IconButton } from '@langgenius/dify-ui/icon-button'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { useKeyboardSortable } from '../use-keyboard-sortable'

function List({
  onChange,
  minIndex = 0,
  itemsOverride,
  disabledOverride,
}: {
  onChange: (items: string[]) => void
  minIndex?: number
  itemsOverride?: string[]
  disabledOverride?: boolean
}) {
  const [items, setItems] = useState(['Pinned', 'Second', 'Third'])
  const [disabled, setDisabled] = useState(false)
  const sortable = useKeyboardSortable({
    items: itemsOverride ?? items,
    minIndex,
    disabled: disabledOverride ?? disabled,
    getItemLabel: (item) => item,
    onChange: (next) => {
      setItems(next)
      onChange(next)
    },
  })
  return (
    <>
      {sortable.announcement}
      <ol>
        {sortable.items.map((item, index) => (
          <li key={sortable.getItemKey(index)}>
            <span>{item}</span>
            <IconButton {...sortable.getHandleProps(index)}>
              <span aria-hidden="true">↕</span>
            </IconButton>
          </li>
        ))}
      </ol>
      <button type="button" onClick={() => setItems(['External', 'Update'])}>
        Replace items
      </button>
      <button type="button" onClick={() => setDisabled((value) => !value)}>
        Toggle permission
      </button>
      <input aria-label="Editor" />
    </>
  )
}

const order = () =>
  screen.getAllByRole('listitem').map((item) => item.textContent?.replace('↕', ''))
const handle = (index: number) =>
  screen.getAllByRole('button', { name: /^common\.sort\.handle/ })[index]!

it('honors a pinned prefix and keeps focus on the moved item after commit and cancel', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(<List onChange={onChange} minIndex={1} />)
  expect(handle(0)).toBeDisabled()
  await user.tab()
  await user.keyboard('{Enter}{ArrowUp}{ArrowDown}{ArrowDown}')
  expect(order()).toEqual(['Pinned', 'Third', 'Second'])
  expect(handle(2)).toHaveFocus()
  expect(onChange).not.toHaveBeenCalled()
  await user.keyboard('{Enter}')
  expect(onChange).toHaveBeenCalledExactlyOnceWith(['Pinned', 'Third', 'Second'])
  expect(handle(2)).toHaveFocus()
  await user.keyboard(' {ArrowUp}{Escape}')
  expect(order()).toEqual(['Pinned', 'Third', 'Second'])
  expect(handle(2)).toHaveFocus()
  expect(onChange).toHaveBeenCalledTimes(1)
})

it('cancels on leaving the handle and never commits stale items after external updates', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(<List onChange={onChange} />)
  await user.tab()
  await user.keyboard(' {ArrowDown}')
  await user.click(screen.getByRole('button', { name: 'Replace items' }))
  expect(order()).toEqual(['External', 'Update'])
  expect(screen.getByRole('button', { name: 'Replace items' })).toHaveFocus()
  expect(onChange).not.toHaveBeenCalled()
  handle(0).focus()
  await user.keyboard(' {ArrowDown}')
  await user.click(screen.getByRole('textbox', { name: 'Editor' }))
  await user.keyboard('{ArrowUp}edited')
  expect(order()).toEqual(['External', 'Update'])
  expect(screen.getByRole('textbox', { name: 'Editor' })).toHaveValue('edited')
  expect(onChange).not.toHaveBeenCalled()
})

it('does not reactivate cancelled sorting when permissions are restored', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  const { rerender } = render(<List onChange={onChange} />)
  await user.tab()
  await user.keyboard('{Enter}{ArrowDown}')
  rerender(<List onChange={onChange} disabledOverride />)
  expect(handle(0)).toBeDisabled()
  rerender(<List onChange={onChange} disabledOverride={false} />)
  expect(order()).toEqual(['Pinned', 'Second', 'Third'])
  expect(handle(0)).toHaveAttribute('aria-pressed', 'false')
  expect(onChange).not.toHaveBeenCalled()
})

it('discards a preview when new items arrive without moving focus away first', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  const { rerender } = render(<List onChange={onChange} />)
  await user.tab()
  await user.keyboard('{Enter}{ArrowDown}')
  rerender(<List onChange={onChange} itemsOverride={['External', 'Update']} />)
  expect(order()).toEqual(['External', 'Update'])
  expect(handle(0)).toHaveAttribute('aria-pressed', 'false')
  expect(handle(1)).toHaveAttribute('aria-pressed', 'false')
  expect(onChange).not.toHaveBeenCalled()
})
