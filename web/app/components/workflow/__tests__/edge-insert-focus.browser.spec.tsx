import ReactFlow from 'reactflow'
import { page, userEvent } from 'vite-plus/test/browser'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import CustomEdge from '../custom-edge'
import { BlockEnum } from '../types'
import { CanvasNodesCatalogProbe } from './canvas-nodes-catalog-probe'
import { renderWorkflowBrowserComponent as render } from './workflow-browser-test-env'
import 'reactflow/dist/style.css'
import '../style.css'
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
  return (
    <>
      <CanvasNodesCatalogProbe />
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
    </>
  )
}

it('reveals the edge insertion control on Tab and keeps it visible after Escape returns focus', async () => {
  // Browser owns focus restoration, ancestor opacity, and actual painted focus ring.
  await page.viewport(1000, 700)
  onTestFinished(guardUnexpectedFetch())
  const screen = await render(<Fixture />)
  await screen.getByRole('button', { name: 'Before canvas' }).click()
  await userEvent.tab()
  const trigger = screen.getByRole('button', { name: 'workflow.common.addBlock' })
  await expect.element(trigger).toHaveFocus()
  await expect.poll(() => trigger.element().checkVisibility({ opacityProperty: true })).toBe(true)
  expect(getComputedStyle(trigger.element()).boxShadow).not.toBe('none')
  await userEvent.keyboard('{Enter}')
  const search = screen.getByRole('searchbox', { name: 'workflow.tabs.searchBlock' })
  await expect.element(search).toHaveFocus()
  await userEvent.keyboard('{Escape}')
  await expect.element(trigger).toHaveFocus()
  await expect.poll(() => trigger.element().checkVisibility({ opacityProperty: true })).toBe(true)
  await expect.element(search).not.toBeInTheDocument()
})
