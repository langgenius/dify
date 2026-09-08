import type { NodeProps, ResizeParamsWithDirection } from 'reactflow'
import type { CommonNodeType } from '@/app/components/workflow/types'
import ReactFlow from 'reactflow'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { BlockEnum } from '@/app/components/workflow/types'
import NodeResizer from '../node-resizer'
import 'reactflow/dist/style.css'

vi.mock('../../../../hooks/use-workflow', () => ({
  useNodesReadOnly: () => ({ nodesReadOnly: false }),
}))

vi.mock('../../../../hooks/use-nodes-interactions', async () => {
  const { useStoreApi } = await import('reactflow')
  return {
    useNodesInteractions: () => {
      const store = useStoreApi()
      return {
        handleNodeResize: (id: string, { width, height }: ResizeParamsWithDirection) => {
          const { getNodes, setNodes } = store.getState()
          setNodes(
            getNodes().map((node) =>
              node.id === id
                ? {
                    ...node,
                    width,
                    height,
                    data: { ...node.data, width, height },
                  }
                : node,
            ),
          )
        },
      }
    },
  }
})

function ResizableNode({ id, data }: NodeProps<CommonNodeType>) {
  return (
    <div
      role="group"
      aria-label="Resizable node"
      className="group relative rounded-lg bg-components-panel-bg"
      style={{ width: data.width, height: data.height }}
    >
      <NodeResizer nodeId={id} nodeData={data} />
    </div>
  )
}

const nodeTypes = { resize: ResizableNode }
const nodes = [
  {
    id: 'node',
    type: 'resize',
    position: { x: 100, y: 100 },
    data: { title: 'Note', desc: '', type: BlockEnum.Iteration, width: 300, height: 200 },
  },
]

it('reveals the resize handle on keyboard focus and preserves mouse dragging', async () => {
  // Browser-owned: opacity on ancestors, native Tab navigation, focus rings and D3 drag hit testing.
  await page.viewport(1000, 800)
  const screen = await render(
    <>
      <button type="button">Before canvas</button>
      <div role="group" aria-label="Canvas" style={{ width: 800, height: 600 }}>
        <ReactFlow defaultNodes={nodes} nodeTypes={nodeTypes} />
      </div>
    </>,
  )
  const node = screen.getByRole('group', { name: 'Resizable node', exact: true })
  const control = screen.getByRole('button', { name: 'common.resize.node' })
  await expect.element(node).toBeVisible()
  await screen.getByRole('button', { name: 'Before canvas' }).click()
  await userEvent.tab()
  await userEvent.tab()
  await expect.element(control).toHaveFocus()
  expect(control.element().checkVisibility({ checkOpacity: true })).toBe(true)
  const focusStyle = getComputedStyle(control.element())
  expect(focusStyle.boxShadow !== 'none' || focusStyle.outlineStyle !== 'none').toBe(true)

  const original = node.element().getBoundingClientRect()
  await userEvent.keyboard('{ArrowRight}{Shift>}{ArrowDown}{/Shift}')
  await expect.poll(() => node.element().getBoundingClientRect().width).toBe(308)
  expect(node.element().getBoundingClientRect().height).toBe(232)
  expect(node.element().getBoundingClientRect().left).toBe(original.left)
  expect(node.element().getBoundingClientRect().top).toBe(original.top)

  await userEvent.dragAndDrop(control, screen.getByRole('group', { name: 'Canvas', exact: true }), {
    targetPosition: { x: 550, y: 450 },
  })
  await expect.poll(() => node.element().getBoundingClientRect().width).toBeGreaterThan(308)
  expect(node.element().getBoundingClientRect().height).toBeGreaterThan(232)
  await userEvent.keyboard('{Enter}')
  await expect.poll(() => node.element().getBoundingClientRect().width).toBe(258)
  expect(node.element().getBoundingClientRect().height).toBe(152)
})
