import type { ReactElement } from 'react'
import type { Collaborator } from '../collaborator-avatar'
import { render as rtlRender, screen } from '@testing-library/react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { COLLABORATOR_COLORS, getUserColor } from '../../utils/user-color'
import { CollaboratorAvatar, CollaboratorAvatarStack } from '../collaborator-avatar'
import { CollaboratorCursor } from '../collaborator-cursor'
import { CollaboratorPill } from '../collaborator-pill'

// Avatars keep one URL per picture in the query cache.
const render = (ui: ReactElement) => rtlRender(ui, { wrapper: createConsoleQueryWrapper().wrapper })

const people: Collaborator[] = [
  { id: 'ann', name: 'Ann', color: '#155AEF' },
  { id: 'bob', name: 'Bob', color: '#DD2590' },
  { id: 'me', name: 'Me' },
]

it('assigns every user one of the twelve design colors, stably', () => {
  expect(COLLABORATOR_COLORS).toHaveLength(12)
  expect(COLLABORATOR_COLORS).toContain(getUserColor('user-1'))
  expect(getUserColor('user-1')).toBe(getUserColor('user-1'))
})

it('stacks named avatars in their colors and folds the rest into +N', () => {
  render(<CollaboratorAvatarStack collaborators={people} maxVisible={2} />)

  expect(screen.getByRole('img', { name: 'Ann' })).toBeInTheDocument()
  expect(screen.getByText('A')).toHaveStyle({ backgroundColor: '#155AEF' })
  expect(screen.queryByRole('img', { name: 'Bob' })).not.toBeInTheDocument()
  expect(screen.getByText('+2')).toBeInTheDocument()
})

it('colors a collaborator by their id unless a color is given', () => {
  render(<CollaboratorAvatarStack collaborators={[people[2]!]} />)

  expect(screen.getByText('M')).toHaveStyle({ backgroundColor: getUserColor('me') })
})

it('shows +N in the pill only when people are folded away, around the avatars it is given', () => {
  const avatars = people.slice(0, 2).map((person) => (
    <button key={person.id} type="button" aria-label={person.name}>
      <CollaboratorAvatar collaborator={person} />
    </button>
  ))
  const { rerender } = render(<CollaboratorPill>{avatars}</CollaboratorPill>)
  expect(screen.getByRole('button', { name: 'Bob' })).toBeInTheDocument()
  expect(screen.queryByText(/^\+/)).not.toBeInTheDocument()

  rerender(<CollaboratorPill overflowCount={3}>{avatars}</CollaboratorPill>)
  expect(screen.getByText('+3')).toBeInTheDocument()
})

it('labels a remote cursor with the collaborator name in their color', () => {
  render(<CollaboratorCursor name="Ralph Edwards" color="#0E9384" />)

  expect(screen.getByText('Ralph Edwards').parentElement).toHaveStyle({
    backgroundColor: '#0E9384',
  })
})
