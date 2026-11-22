import type { ReactElement } from 'react'
import type { Collaborator } from '../collaborator-avatar'
import { render as rtlRender, screen } from '@testing-library/react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { COLLABORATOR_COLORS, getUserColor } from '../../utils/user-color'
import { CollaboratorAvatarStack } from '../collaborator-avatar'
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

it('keeps the default fill for a collaborator without a color', () => {
  render(<CollaboratorAvatarStack collaborators={[people[2]!]} />)

  expect(screen.getByText('M')).not.toHaveAttribute('style')
})

it('shows +N in the pill only when people are folded away, and lets callers wrap avatars', () => {
  const { rerender } = render(
    <CollaboratorPill
      collaborators={people.slice(0, 2)}
      renderAvatar={(avatar, collaborator) => (
        <button type="button" aria-label={collaborator.name}>
          {avatar}
        </button>
      )}
    />,
  )
  expect(screen.getByRole('button', { name: 'Bob' })).toBeInTheDocument()
  expect(screen.queryByText(/^\+/)).not.toBeInTheDocument()

  rerender(<CollaboratorPill collaborators={people.slice(0, 2)} overflowCount={3} />)
  expect(screen.getByText('+3')).toBeInTheDocument()
})

it('labels a remote cursor with the collaborator name in their color', () => {
  render(<CollaboratorCursor name="Ralph Edwards" color="#0E9384" />)

  expect(screen.getByText('Ralph Edwards')).toHaveStyle({ backgroundColor: '#0E9384' })
})
