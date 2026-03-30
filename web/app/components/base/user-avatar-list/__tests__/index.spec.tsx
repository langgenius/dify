import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UserAvatarList } from '../index'

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    userProfile: { id: 'current-user' },
  }),
}))

vi.mock('@/app/components/workflow/collaboration/utils/user-color', () => ({
  getUserColor: (id: string) => `color-${id}`,
}))

const users = [
  { id: 'current-user', name: 'Alice', avatar_url: 'https://example.com/alice.png' },
  { id: 'user-2', name: 'Bob' },
  { id: 'user-3', name: 'Carol' },
  { id: 'user-4', name: 'Dave' },
]

describe('UserAvatarList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render nothing when user list is empty', () => {
    const { container } = render(<UserAvatarList users={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('should render visible avatars and overflow count', () => {
    render(<UserAvatarList users={users} maxVisible={3} />)

    expect(screen.getByText('A')).toBeInTheDocument()
    expect(screen.getByText('B')).toBeInTheDocument()
    expect(screen.getByText('+2')).toBeInTheDocument()
  })

  it('should hide overflow count when showCount is false', () => {
    render(<UserAvatarList users={users} maxVisible={2} showCount={false} />)

    expect(screen.queryByText(/\+\d/)).not.toBeInTheDocument()
    expect(screen.getByText('B')).toBeInTheDocument()
  })

  it('should not apply generated background color for the current user', () => {
    render(<UserAvatarList users={users.slice(0, 2)} />)

    expect(screen.getByText('A')).not.toHaveAttribute('style')
    expect(screen.getByText('B')).toHaveStyle({ backgroundColor: 'color-user-2' })
  })

  it('should map numeric size to the nearest avatar size token', () => {
    render(<UserAvatarList users={users.slice(0, 1)} size={39} />)

    expect(screen.getByText('A').parentElement).toHaveClass('size-10')
  })
})
