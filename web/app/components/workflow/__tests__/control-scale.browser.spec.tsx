import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useRef, useState } from 'react'
import ReactFlow, { ReactFlowProvider, useReactFlow } from 'reactflow'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { useWorkflowControlScale } from '../hooks/use-workflow-control-scale'
import 'reactflow/dist/style.css'

function ControlNode() {
  const [activations, setActivations] = useState(0)

  return (
    <div
      role="group"
      aria-label="Canvas node"
      style={{ width: 200, height: 100, display: 'grid', placeItems: 'center' }}
    >
      <IconButton
        aria-label="Canvas action"
        className="nodrag nopan"
        size="md"
        style={{ scale: 'var(--workflow-control-scale, 1)' }}
        onClick={() => setActivations((count) => count + 1)}
      >
        <span aria-hidden className="i-ri-add-line size-4" />
      </IconButton>
      <output aria-label="Action count" style={{ position: 'absolute', top: 0, left: 0 }}>
        {activations}
      </output>
    </div>
  )
}

const nodeTypes = { control: ControlNode }
const nodes = [{ id: 'control', type: 'control', position: { x: 200, y: 200 }, data: {} }]

function Canvas() {
  const containerRef = useRef<HTMLDivElement>(null)
  const { zoomTo, setViewport, getViewport } = useReactFlow()
  useWorkflowControlScale(containerRef)

  return (
    <>
      {[0.25, 0.5, 1].map((zoom) => (
        <button type="button" key={zoom} onClick={() => zoomTo(zoom)}>
          Zoom {zoom * 100}%
        </button>
      ))}
      <button
        type="button"
        onClick={() => {
          const viewport = getViewport()
          setViewport({ ...viewport, x: viewport.x + 20, y: viewport.y + 20 })
        }}
      >
        Pan canvas
      </button>
      <div ref={containerRef} style={{ width: 800, height: 600 }}>
        <ReactFlow defaultNodes={nodes} nodeTypes={nodeTypes} minZoom={0.25} />
      </div>
    </>
  )
}

it('keeps a 24 CSS pixel canvas action reachable while zooming out and panning', async () => {
  // Browser-owned: nested CSS transforms determine the actual pointer target, not its layout size.
  await page.viewport(1000, 800)
  const screen = await render(
    <ReactFlowProvider>
      <Canvas />
    </ReactFlowProvider>,
  )
  const action = screen.getByRole('button', { name: 'Canvas action' })

  for (const [index, zoom] of [1, 0.5, 0.25, 1].entries()) {
    await screen.getByRole('button', { name: `Zoom ${zoom * 100}%` }).click()
    await expect.poll(() => action.element().getBoundingClientRect().width).toBeCloseTo(24)
    const target = action.element().getBoundingClientRect()
    const node = screen
      .getByRole('group', { name: 'Canvas node' })
      .element()
      .getBoundingClientRect()
    expect(target.height).toBeCloseTo(24)
    expect(target.x + target.width / 2).toBeCloseTo(node.x + node.width / 2)
    expect(target.y + target.height / 2).toBeCloseTo(node.y + node.height / 2)
    await action.click({ position: { x: 2, y: 2 } })
    await expect.element(screen.getByLabelText('Action count')).toHaveTextContent(String(index + 1))
  }

  const beforePan = action.element().getBoundingClientRect()
  await screen.getByRole('button', { name: 'Pan canvas' }).click()
  await expect.poll(() => action.element().getBoundingClientRect().x).toBeCloseTo(beforePan.x + 20)
  expect(action.element().getBoundingClientRect().width).toBeCloseTo(24)
  await action.click({ position: { x: 22, y: 22 } })
  await expect.element(screen.getByLabelText('Action count')).toHaveTextContent('5')
})
