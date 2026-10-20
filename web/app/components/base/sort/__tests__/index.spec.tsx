import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import Sort from '../index'

const items = [
  { value: 'created_at', name: 'Date Created' },
  { value: 'name', name: 'Name' },
]

it('selects a valid ascending sort key when no direction is supplied', async () => {
  const user = userEvent.setup()
  const onSelect = vi.fn()
  render(<Sort items={items} value="created_at" onSelect={onSelect} />)
  await user.click(screen.getByRole('button', { name: /appLog.filter.sortBy/ }))
  await user.click(screen.getByRole('menuitemradio', { name: 'Name' }))
  expect(onSelect).toHaveBeenCalledExactlyOnceWith('name')
})

it('preserves direction when choosing a field and toggles it without losing the field', async () => {
  const user = userEvent.setup()
  const onSelect = vi.fn()
  function Harness() {
    const [sort, setSort] = useState('-created_at')
    return (
      <Sort
        items={items}
        value={sort.replace(/^-/, '')}
        order={sort.startsWith('-') ? '-' : ''}
        onSelect={(next) => {
          onSelect(next)
          setSort(next)
        }}
      />
    )
  }
  render(<Harness />)
  const trigger = screen.getByRole('button', { name: /appLog.filter.sortBy/ })
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
  expect(onSelect).toHaveBeenLastCalledWith('-name')
  await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
  expect(trigger).toHaveTextContent('Name')
  await user.click(screen.getByRole('button', { name: 'appLog.filter.ascending' }))
  expect(onSelect).toHaveBeenLastCalledWith('name')
  await user.click(screen.getByRole('button', { name: 'appLog.filter.descending' }))
  expect(onSelect).toHaveBeenLastCalledWith('-name')
})
