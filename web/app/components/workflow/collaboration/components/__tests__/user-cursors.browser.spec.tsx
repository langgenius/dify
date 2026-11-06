import type { CursorPosition, OnlineUser } from '../../types/collaboration'
import { act } from 'react'
import { cdp } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import UserCursors from '../user-cursors'

const mocks = vi.hoisted(() => ({ viewport: { x: 40, y: 50, zoom: 2 } }))
let onCursorUpdate: (cursors: Record<string, CursorPosition>) => void

vi.mock('reactflow', () => ({ useViewport: () => mocks.viewport }))
vi.mock('../../core/collaboration-manager', () => ({
  collaborationManager: {
    onCursorUpdate: (callback: typeof onCursorUpdate) => {
      onCursorUpdate = callback
      return () => undefined
    },
  },
}))

it('keeps cursors aligned during pan and zoom and moves immediately with reduced motion', async () => {
  // Real layout and CSS media queries prove cursor alignment and motion preferences.
  const session = cdp()
  const setMotion = (value: 'reduce' | 'no-preference') =>
    session.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value }],
    })
  const onlineUsers: OnlineUser[] = [
    { user_id: 'remote', username: 'Remote editor', avatar: '', sid: 'remote-session' },
  ]
  const overlay = () => (
    <section aria-label="Workflow canvas" className="relative h-100 w-150">
      <UserCursors visible myUserId="self" onlineUsers={onlineUsers} />
    </section>
  )
  await setMotion('no-preference')
  const screen = await render(overlay())
  try {
    await act(async () => {
      onCursorUpdate({ remote: { x: 10, y: 20, userId: 'remote', timestamp: 1 } })
    })
    const name = screen.getByText('Remote editor')
    await expect.element(name).toBeVisible()
    const canvas = screen
      .getByRole('region', { name: 'Workflow canvas' })
      .element()
      .getBoundingClientRect()
    const position = () => {
      const rect = name.element().getBoundingClientRect()
      return { x: Math.round(rect.left - canvas.left), y: Math.round(rect.top - canvas.top) }
    }
    expect(position()).toEqual({ x: 76, y: 106 })

    mocks.viewport = { x: 100, y: 70, zoom: 0.5 }
    await screen.rerender(overlay())
    await expect.poll(position).toEqual({ x: 121, y: 96 })

    await setMotion('reduce')
    await expect.poll(() => matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(true)
    await act(async () => {
      onCursorUpdate({ remote: { x: 100, y: 80, userId: 'remote', timestamp: 2 } })
    })
    expect(position()).toEqual({ x: 166, y: 126 })
  } finally {
    await session.send('Emulation.setEmulatedMedia', { features: [] })
  }
})
