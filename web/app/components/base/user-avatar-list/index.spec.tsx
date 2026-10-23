import { screen } from '@testing-library/react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { render } from '@/test/console/render'
import { UserAvatarList } from '.'

it('counts people once across multiple connections and keeps them until their last connection leaves', () => {
  const alice = { id: 'alice', name: 'Alice' }
  const bob = { id: 'bob', name: 'Bob' }
  const carol = { id: 'carol', name: 'Carol' }
  const dave = { id: 'dave', name: 'Dave' }
  const { rerender } = render(<UserAvatarList users={[alice, alice, bob, carol, dave]} />, {
    wrapper: createConsoleQueryWrapper({ accountProfile: { id: 'alice' } }).wrapper,
  })

  expect(screen.getAllByRole('img', { name: 'Alice' })).toHaveLength(1)
  expect(screen.getByRole('img', { name: 'Bob' })).toBeInTheDocument()
  expect(screen.getByText('+2')).toBeInTheDocument()

  rerender(<UserAvatarList users={[alice, bob, carol, dave]} />)
  expect(screen.getAllByRole('img', { name: 'Alice' })).toHaveLength(1)
  expect(screen.getByText('+2')).toBeInTheDocument()

  rerender(<UserAvatarList users={[bob, carol, dave]} />)
  expect(screen.queryByRole('img', { name: 'Alice' })).not.toBeInTheDocument()
  expect(screen.getAllByRole('img').map((avatar) => avatar.getAttribute('aria-label'))).toEqual([
    'Bob',
    'Carol',
    'Dave',
  ])
  expect(screen.queryByText(/^\+\d+$/)).not.toBeInTheDocument()
})
