import type { CursorPosition, OnlineUser } from '../../types/collaboration'
import { act, render, screen } from '@testing-library/react'
import UserCursors from '../user-cursors'

let onCursorUpdate: ((cursors: Record<string, CursorPosition>) => void) | undefined
const unsubscribe = vi.fn()

vi.mock('reactflow', () => ({
  useViewport: () => ({ x: 0, y: 0, zoom: 1 }),
}))

vi.mock('../../core/collaboration-manager', () => ({
  collaborationManager: {
    onCursorUpdate: (callback: (cursors: Record<string, CursorPosition>) => void) => {
      onCursorUpdate = callback
      return unsubscribe
    },
  },
}))

describe('UserCursors', () => {
  beforeEach(() => {
    onCursorUpdate = undefined
    unsubscribe.mockClear()
  })

  it('updates only the cursor overlay when remote positions change', () => {
    const onlineUsers = [{ user_id: 'remote', username: 'Remote editor' }] as OnlineUser[]
    const { rerender, unmount } = render(
      <UserCursors visible={false} myUserId="self" onlineUsers={onlineUsers} />,
    )

    act(() => {
      onCursorUpdate?.({
        remote: { x: 10, y: 20, userId: 'remote', timestamp: 1 },
        self: { x: 30, y: 40, userId: 'self', timestamp: 1 },
      })
    })
    expect(screen.queryByText('Remote editor')).not.toBeInTheDocument()
    rerender(<UserCursors visible myUserId="self" onlineUsers={onlineUsers} />)
    expect(screen.getByText('Remote editor')).toBeInTheDocument()
    expect(screen.queryByText('User self')).not.toBeInTheDocument()

    act(() => onCursorUpdate?.({}))
    expect(screen.queryByText('Remote editor')).not.toBeInTheDocument()

    unmount()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})
