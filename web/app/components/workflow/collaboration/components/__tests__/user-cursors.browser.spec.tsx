import type { CursorPosition } from '../../types/collaboration'
import { act } from 'react'
import ReactFlow, { ReactFlowProvider, useReactFlow } from 'reactflow'
import { cdp } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import UserCursors from '../user-cursors'
import 'reactflow/dist/style.css'

let onCursorUpdate: ((cursors: Record<string, CursorPosition>) => void) | undefined

// boundary: cursor updates come from the realtime transport.
vi.mock('../../core/collaboration-manager', () => ({
  collaborationManager: {
    onCursorUpdate: (callback: NonNullable<typeof onCursorUpdate>) => {
      onCursorUpdate = callback
      return () => {
        onCursorUpdate = undefined
      }
    },
  },
}))

const updateCursor = (position: { x: number; y: number }) =>
  act(async () => {
    onCursorUpdate?.({ bob: { ...position, userId: 'bob', timestamp: 1 } })
  })

const position = { x: 180, y: 100 }
const nodes = [{ id: 'node', position, ariaLabel: 'Canvas node', data: { label: 'Canvas node' } }]
const onlineUsers = [{ user_id: 'bob', username: 'Bob', avatar: '', sid: 'bob-session' }]

function Canvas() {
  const { setViewport } = useReactFlow()
  return (
    <>
      <button
        type="button"
        onClick={() => setViewport({ x: 200, y: 80, zoom: 1.5 }, { duration: 500 })}
      >
        Move canvas
      </button>
      <div style={{ width: 800, height: 450 }}>
        <ReactFlow defaultNodes={nodes}>
          <UserCursors visible onlineUsers={onlineUsers} myUserId="alice" />
        </ReactFlow>
      </div>
    </>
  )
}

it('keeps an idle collaborator aligned with a node throughout pan and zoom', async () => {
  const screen = await render(
    <ReactFlowProvider>
      <Canvas />
    </ReactFlowProvider>,
  )
  await updateCursor(position)
  const node = screen.getByRole('button', { name: 'Canvas node' })
  const cursor = screen.getByText('Bob')
  await expect.element(node).toBeVisible()
  await expect.element(cursor).toBeVisible()

  const measure = () => {
    const nodeRect = node.element().getBoundingClientRect()
    const cursorRect = cursor.element().getBoundingClientRect()
    return {
      nodeX: nodeRect.x,
      nodeWidth: nodeRect.width,
      offsetX: cursorRect.x - nodeRect.x,
      offsetY: cursorRect.y - nodeRect.y,
      cursorWidth: cursorRect.width,
    }
  }
  const initial = measure()

  await screen.getByRole('button', { name: 'Move canvas' }).click()
  // Capture a rendered frame while the camera is still moving.
  let during = initial
  await expect
    .poll(() => {
      during = measure()
      return during.nodeWidth / initial.nodeWidth
    })
    .toBeGreaterThan(1.15)

  expect(during.nodeWidth).toBeLessThan(initial.nodeWidth * 1.45)
  expect(during.nodeX).toBeGreaterThan(initial.nodeX)
  expect(during.offsetX).toBeCloseTo(initial.offsetX, 0)
  expect(during.offsetY).toBeCloseTo(initial.offsetY, 0)
  expect(during.cursorWidth).toBeCloseTo(initial.cursorWidth, 0)
})

it('moves collaborator cursors immediately when reduced motion is preferred', async () => {
  const session = cdp()
  await session.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  })
  try {
    const screen = await render(
      <ReactFlowProvider>
        <Canvas />
      </ReactFlowProvider>,
    )
    await updateCursor(position)
    const cursor = screen.getByText('Bob')
    await expect.element(cursor).toBeVisible()
    const before = cursor.element().getBoundingClientRect()

    await updateCursor({ x: position.x + 30, y: position.y + 40 })
    const after = cursor.element().getBoundingClientRect()
    expect(after.x - before.x).toBeCloseTo(30, 0)
    expect(after.y - before.y).toBeCloseTo(40, 0)
  } finally {
    await session.send('Emulation.setEmulatedMedia', { features: [] })
  }
})
