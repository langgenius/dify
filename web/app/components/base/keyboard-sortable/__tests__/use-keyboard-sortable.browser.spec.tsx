import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { useKeyboardSortable } from '../use-keyboard-sortable'

function List({
  minIndex = 0,
  itemsOverride,
  disabledOverride,
}: {
  minIndex?: number
  itemsOverride?: string[]
  disabledOverride?: boolean
}) {
  const [items, setItems] = useState(['Pinned', 'Second', 'Third'])
  const [disabled, setDisabled] = useState(false)
  const [saved, setSaved] = useState(['Pinned', 'Second', 'Third'])
  const sortable = useKeyboardSortable({
    items: itemsOverride ?? items,
    minIndex,
    disabled: disabledOverride ?? disabled,
    getItemLabel: (item) => item,
    onChange: (next) => {
      setItems(next)
      setSaved(next)
    },
  })
  return (
    <>
      {sortable.announcement}
      <output aria-label="Saved order">{saved.join(', ')}</output>
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
  Array.from(page.getByRole('listitem').elements(), (item) => item.textContent?.replace('↕', ''))
const handle = (index: number) =>
  page.getByRole('button', { name: /^common\.sort\.handle/ }).nth(index)
const saved = () => page.getByRole('status', { name: 'Saved order' })

it('honors a pinned prefix and keeps native focus with the moved item through commit and cancel', async () => {
  await page.viewport(1000, 800)
  await render(<List minIndex={1} />)
  await expect.element(handle(0)).toBeDisabled()
  await userEvent.tab()
  await expect.element(handle(1)).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(handle(1)).toHaveAttribute('aria-pressed', 'true')
  await userEvent.keyboard('{ArrowUp}{ArrowDown}')
  await expect.element(handle(2)).toHaveFocus()
  await userEvent.keyboard('{ArrowDown}')
  expect(order()).toEqual(['Pinned', 'Third', 'Second'])
  await expect.element(saved()).toHaveTextContent('Pinned, Second, Third')
  await userEvent.keyboard('{Enter}')
  await expect.element(saved()).toHaveTextContent('Pinned, Third, Second')
  await expect.element(handle(2)).toHaveFocus()
  await userEvent.keyboard(' ')
  await expect.element(handle(2)).toHaveAttribute('aria-pressed', 'true')
  await userEvent.keyboard('{ArrowUp}')
  await expect.element(handle(1)).toHaveFocus()
  await userEvent.keyboard('{Escape}')
  expect(order()).toEqual(['Pinned', 'Third', 'Second'])
  await expect.element(handle(2)).toHaveFocus()
  await expect.element(saved()).toHaveTextContent('Pinned, Third, Second')
})

it('cancels on leaving the handle and never saves a stale preview after external replacement', async () => {
  await page.viewport(1000, 800)
  await render(<List />)
  await userEvent.tab()
  await userEvent.keyboard(' ')
  await expect.element(handle(0)).toHaveAttribute('aria-pressed', 'true')
  await userEvent.keyboard('{ArrowDown}')
  await expect.element(handle(1)).toHaveFocus()
  await page.getByRole('button', { name: 'Replace items' }).click()
  expect(order()).toEqual(['External', 'Update'])
  await expect.element(page.getByRole('button', { name: 'Replace items' })).toHaveFocus()
  await expect.element(saved()).toHaveTextContent('Pinned, Second, Third')
  await expect.element(handle(0)).toBeVisible()
  handle(0).element().focus()
  await userEvent.keyboard(' ')
  await expect.element(handle(0)).toHaveAttribute('aria-pressed', 'true')
  await userEvent.keyboard('{ArrowDown}')
  await expect.element(handle(1)).toHaveFocus()
  await page.getByRole('textbox', { name: 'Editor' }).click()
  await userEvent.keyboard('{ArrowUp}edited')
  expect(order()).toEqual(['External', 'Update'])
  await expect.element(page.getByRole('textbox', { name: 'Editor' })).toHaveValue('edited')
  await expect.element(saved()).toHaveTextContent('Pinned, Second, Third')
})

it('does not reactivate a cancelled preview when permissions are restored', async () => {
  await page.viewport(1000, 800)
  const screen = await render(<List />)
  await userEvent.tab()
  await userEvent.keyboard('{Enter}')
  await expect.element(handle(0)).toHaveAttribute('aria-pressed', 'true')
  await userEvent.keyboard('{ArrowDown}')
  await expect.element(handle(1)).toHaveFocus()
  await screen.rerender(<List disabledOverride />)
  await expect.element(handle(0)).toBeDisabled()
  await screen.rerender(<List disabledOverride={false} />)
  expect(order()).toEqual(['Pinned', 'Second', 'Third'])
  await expect.element(handle(0)).toHaveAttribute('aria-pressed', 'false')
  await expect.element(saved()).toHaveTextContent('Pinned, Second, Third')
})

it('discards a preview when replacement items arrive while the handle still owns focus', async () => {
  await page.viewport(1000, 800)
  const screen = await render(<List />)
  await userEvent.tab()
  await userEvent.keyboard('{Enter}')
  await expect.element(handle(0)).toHaveAttribute('aria-pressed', 'true')
  await userEvent.keyboard('{ArrowDown}')
  await expect.element(handle(1)).toHaveFocus()
  await screen.rerender(<List itemsOverride={['External', 'Update']} />)
  expect(order()).toEqual(['External', 'Update'])
  await expect.element(handle(0)).toHaveAttribute('aria-pressed', 'false')
  await expect.element(handle(1)).toHaveAttribute('aria-pressed', 'false')
  await expect.element(saved()).toHaveTextContent('Pinned, Second, Third')
})
