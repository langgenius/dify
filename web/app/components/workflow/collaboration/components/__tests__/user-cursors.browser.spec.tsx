import ReactFlow, { ReactFlowProvider, useReactFlow } from 'reactflow'
import { render } from 'vitest-browser-react'
import UserCursors from '../user-cursors'
import 'reactflow/dist/style.css'

const position = { x: 180, y: 100 }
const nodes = [{ id: 'node', position, ariaLabel: 'Canvas node', data: { label: 'Canvas node' } }]
const cursors = { bob: { ...position, userId: 'bob', timestamp: 1 } }
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
          <UserCursors cursors={cursors} onlineUsers={onlineUsers} myUserId="alice" />
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
