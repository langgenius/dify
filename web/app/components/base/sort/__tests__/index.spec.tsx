import type { SortValue } from '../index'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { Sort } from '../index'

const items = [
  { value: 'created_at', name: 'Date Created' },
  { value: 'name', name: 'Name' },
] as const

it('requests a new field without changing the controlled value or its direction', async () => {
  const user = userEvent.setup()
  const onValueChange = vi.fn()
  render(
    <Sort
      items={items}
      value={{ field: 'created_at', order: 'asc' }}
      onValueChange={onValueChange}
    />,
  )
  await user.click(screen.getByRole('button', { name: /common.sorting.sortBy/ }))
  await user.click(screen.getByRole('menuitemradio', { name: 'Name' }))
  expect(onValueChange).toHaveBeenCalledExactlyOnceWith({ field: 'name', order: 'asc' })
  expect(screen.getByRole('button', { name: /common.sorting.sortBy/ })).toHaveTextContent(
    'Date Created',
  )
  await user.click(screen.getByRole('button', { name: 'common.sorting.descending' }))
  expect(onValueChange).toHaveBeenLastCalledWith({ field: 'created_at', order: 'desc' })
  expect(screen.getByRole('button', { name: 'common.sorting.descending' })).toBeInTheDocument()
})

it('preserves direction when choosing a field and toggles it without losing the field', async () => {
  const user = userEvent.setup()
  const onValueChange = vi.fn()
  function Harness() {
    const [sort, setSort] = useState<SortValue<(typeof items)[number]['value']>>({
      field: 'created_at',
      order: 'desc',
    })
    return (
      <Sort
        items={items}
        value={sort}
        onValueChange={(next) => {
          onValueChange(next)
          setSort(next)
        }}
      />
    )
  }
  render(<Harness />)
  const trigger = screen.getByRole('button', { name: /common.sorting.sortBy/ })
  await user.click(trigger)
  expect(screen.getByRole('menuitemradio', { name: 'Date Created' })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  expect(screen.getByRole('menuitemradio', { name: 'Name' })).toHaveAttribute(
    'aria-checked',
    'false',
  )
  await user.click(screen.getByRole('menuitemradio', { name: 'Name' }))
  expect(onValueChange).toHaveBeenLastCalledWith({ field: 'name', order: 'desc' })
  await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
  expect(trigger).toHaveTextContent('Name')
  const directionButton = screen.getByRole('button', { name: 'common.sorting.ascending' })
  expect(directionButton).not.toHaveAttribute('aria-pressed')
  await user.hover(directionButton)
  expect(await screen.findByText('common.sorting.ascending')).toBeVisible()
  await user.click(directionButton)
  expect(onValueChange).toHaveBeenLastCalledWith({ field: 'name', order: 'asc' })
  await waitFor(() =>
    expect(screen.queryByText('common.sorting.descending')).not.toBeInTheDocument(),
  )
  await user.click(screen.getByRole('button', { name: 'common.sorting.descending' }))
  expect(onValueChange).toHaveBeenLastCalledWith({ field: 'name', order: 'desc' })
})
it('preserves numeric field identifiers when selecting a field or changing direction', async () => {
  const user = userEvent.setup()
  const onValueChange = vi.fn()
  render(
    <Sort
      items={[
        { value: 0, name: 'First field' },
        { value: 1, name: 'Second field' },
      ]}
      value={{ field: 0, order: 'desc' }}
      onValueChange={onValueChange}
    />,
  )
  await user.click(screen.getByRole('button', { name: 'common.sorting.ascending' }))
  expect(onValueChange).toHaveBeenLastCalledWith({ field: 0, order: 'asc' })
  await user.click(screen.getByRole('button', { name: /common.sorting.sortBy/ }))
  await user.click(screen.getByRole('menuitemradio', { name: 'Second field' }))
  expect(onValueChange).toHaveBeenLastCalledWith({ field: 1, order: 'desc' })
})
