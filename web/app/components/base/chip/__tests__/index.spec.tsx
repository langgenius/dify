import type { Item } from '../index'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Chip from '../index'

const items: Item[] = [
  { value: 'all', name: 'All Items', triggerName: 'Item Types' },
  { value: 'active', name: 'Active' },
  { value: 'archived', name: 'Archived' },
]

describe('Chip', () => {
  it('uses the trigger label without replacing the option label', async () => {
    const user = userEvent.setup()
    render(<Chip value="all" items={items} onSelect={vi.fn()} onClear={vi.fn()} />)

    await user.click(screen.getByRole('combobox', { name: 'Item Types' }))

    const listbox = await screen.findByRole('listbox')
    expect(within(listbox).getByRole('option', { name: 'All Items' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(within(listbox).queryByRole('option', { name: 'Item Types' })).not.toBeInTheDocument()
  })

  it('selects an item and closes the listbox', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<Chip value="all" items={items} onSelect={onSelect} onClear={vi.fn()} />)

    await user.click(screen.getByRole('combobox', { name: 'Item Types' }))
    await user.click(await screen.findByRole('option', { name: 'Active' }))

    expect(onSelect).toHaveBeenCalledWith(items[1])
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('clears the selected value without opening the listbox', async () => {
    const user = userEvent.setup()
    const onClear = vi.fn()
    render(<Chip value="active" items={items} onSelect={vi.fn()} onClear={onClear} />)

    await user.click(screen.getByRole('button', { name: /common\.operation\.clear Active/ }))

    expect(onClear).toHaveBeenCalledOnce()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('treats numeric zero as a selected value', () => {
    const numericItems: Item<number>[] = [
      { value: 0, name: 'Zero' },
      { value: 1, name: 'One' },
    ]

    render(<Chip value={0} items={numericItems} onSelect={vi.fn()} onClear={vi.fn()} />)

    expect(screen.getByRole('combobox', { name: 'Zero' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /common\.operation\.clear Zero/ }),
    ).toBeInTheDocument()
  })
})
