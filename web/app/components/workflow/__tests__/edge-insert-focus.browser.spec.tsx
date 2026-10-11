import type { RefObject } from 'react'
import { useState } from 'react'
import ReactFlow, { ReactFlowProvider } from 'reactflow'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { WorkflowContext } from '../context'
import CustomEdge from '../custom-edge'
import { createWorkflowStore } from '../store/workflow'
import { BlockEnum } from '../types'
import 'reactflow/dist/style.css'
import '../style.css'

vi.mock('../hooks/use-available-blocks', () => ({
  useAvailableBlocks: () => ({
    availablePrevBlocks: [BlockEnum.Code],
    availableNextBlocks: [BlockEnum.Code],
  }),
}))
vi.mock('../hooks/use-nodes-interactions', () => ({
  useNodesInteractions: () => ({ handleNodeAdd: vi.fn() }),
}))
vi.mock('../hooks-store', () => ({
  useHooksStore: (selector: (state: object) => unknown) => selector({}),
}))
// Picker results are unrelated to focus entering and returning from its real Popover.
vi.mock('../block-selector/tabs', () => ({
  BlockSelectorPanels: ({ searchInputRef }: { searchInputRef: RefObject<HTMLInputElement> }) => (
    <input ref={searchInputRef} aria-label="Find a node" />
  ),
}))
const edgeTypes = { custom: CustomEdge }
const nodes = [
  {
    id: 'input',
    position: { x: 50, y: 100 },
    data: { label: 'Input', title: 'Input', type: BlockEnum.Start },
  },
  {
    id: 'output',
    position: { x: 400, y: 200 },
    data: { label: 'Output', title: 'Output', type: BlockEnum.Code },
  },
]
const edges = [
  {
    id: 'edge',
    source: 'input',
    target: 'output',
    type: 'custom',
    data: { sourceType: BlockEnum.Start, targetType: BlockEnum.Code },
  },
]
function Fixture() {
  const [store] = useState(() => createWorkflowStore({}))
  return (
    <WorkflowContext value={store}>
      <ReactFlowProvider>
        <button type="button">Before canvas</button>
        <div style={{ width: 800, height: 500 }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            edgeTypes={edgeTypes}
            nodesFocusable={false}
            edgesFocusable={false}
          />
        </div>
      </ReactFlowProvider>
    </WorkflowContext>
  )
}

it('reveals the edge insertion control on Tab and keeps it visible after Escape returns focus', async () => {
  // Browser owns focus restoration, ancestor opacity, and actual painted focus ring.
  await page.viewport(1000, 700)
  const screen = await render(<Fixture />)
  await screen.getByRole('button', { name: 'Before canvas' }).click()
  await userEvent.tab()
  const trigger = screen.getByRole('button', { name: 'workflow.common.addBlock' })
  await expect.element(trigger).toHaveFocus()
  await expect.poll(() => getComputedStyle(trigger.element().parentElement!).opacity).toBe('1')
  expect(getComputedStyle(trigger.element()).boxShadow).not.toBe('none')
  await userEvent.keyboard('{Enter}')
  await expect.element(screen.getByRole('textbox', { name: 'Find a node' })).toHaveFocus()
  await userEvent.keyboard('{Escape}')
  await expect.element(trigger).toHaveFocus()
  await expect.poll(() => getComputedStyle(trigger.element().parentElement!).opacity).toBe('1')
  await expect.element(screen.getByRole('textbox', { name: 'Find a node' })).not.toBeInTheDocument()
})
