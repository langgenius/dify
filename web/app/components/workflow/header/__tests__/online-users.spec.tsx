import type { CursorPosition } from '../../collaboration/types/collaboration'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import OnlineUsers from '../online-users'

let onCursorUpdate: ((cursors: Record<string, CursorPosition>) => void) | undefined
const setCenter = vi.fn()
const unsubscribe = vi.fn()

vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useSuspenseQuery: () => ({ data: 'self' }),
}))

vi.mock('reactflow', () => ({
  useReactFlow: () => ({ setCenter }),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: { appId: string }) => unknown) => selector({ appId: 'app-1' }),
}))

vi.mock('../../hooks-store', () => ({
  useHooksStore: (selector: (state: { accessControl: { canEdit: boolean } }) => unknown) =>
    selector({ accessControl: { canEdit: true } }),
}))

vi.mock('../../collaboration/hooks/use-collaboration', () => ({
  useCollaboration: () => ({
    isEnabled: true,
    onlineUsers: [
      { user_id: 'self', username: 'Me', avatar: '', sid: 'self-session' },
      { user_id: 'remote', username: 'Remote editor', avatar: '', sid: 'remote-session' },
    ],
  }),
}))

vi.mock('../../collaboration/core/collaboration-manager', () => ({
  collaborationManager: {
    onCursorUpdate: (callback: (cursors: Record<string, CursorPosition>) => void) => {
      onCursorUpdate = callback
      return unsubscribe
    },
  },
}))

describe('OnlineUsers', () => {
  beforeEach(() => {
    onCursorUpdate = undefined
    setCenter.mockClear()
    unsubscribe.mockClear()
  })

  it('jumps to the latest remote cursor when an avatar is clicked', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<OnlineUsers />)

    act(() => {
      onCursorUpdate?.({ remote: { x: 10, y: 20, userId: 'remote', timestamp: 1 } })
      onCursorUpdate?.({ remote: { x: 40, y: 50, userId: 'remote', timestamp: 2 } })
    })
    await user.click(screen.getByRole('button', { name: 'Remote editor' }))

    expect(setCenter).toHaveBeenCalledWith(40, 50, { zoom: 1, duration: 800 })
    unmount()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})
