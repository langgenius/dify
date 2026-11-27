import type { FlowHandle } from './workflow-canvas-fixture'
import { page, userEvent } from 'vite-plus/test/browser'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { renderWorkflowBrowserComponent } from '../../__tests__/workflow-browser-test-env'
import ViewWorkflowHistory from '../../header/view-workflow-history'
import { ControlMode } from '../../types'
import { WorkflowCanvasFixture } from './workflow-canvas-fixture'
import {
  initialNodes,
  recordHistory,
  redo,
  setupWorkflowCanvas,
  undo,
} from './workflow-canvas-test-env'

// boundary: routing is external to canvas history restoration.
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

describe('Workflow canvas empty graph history', () => {
  it('redoes deletion of the last node on the live canvas', async () => {
    const screen = await setupWorkflowCanvas({ nodes: initialNodes.slice(0, 1) })
    const canvas = screen.getByRole('region', { name: 'app.types.workflow' })
    const node = screen.getByRole('button', { name: 'Workflow node' })
    await node.click()
    await recordHistory(() => userEvent.keyboard('{Delete}'))
    await expect.element(node).not.toBeInTheDocument()
    expect(screen.graphNodes()).toEqual([])
    expect(screen.graphEdges()).toEqual([])

    await undo()
    await expect.element(node).toBeInTheDocument()
    await redo()
    await expect.element(node).not.toBeInTheDocument()
    expect(screen.graphNodes()).toEqual([])
    expect(screen.graphEdges()).toEqual([])
    await expect.element(canvas).toHaveFocus()

    await undo()
    await expect.element(node).toBeInTheDocument()
    await redo()
    await expect.element(node).not.toBeInTheDocument()
  })
  it('applies an empty snapshot selected from the history picker', async () => {
    await page.viewport(1000, 700)
    const nodes = initialNodes.slice(0, 1)
    const flowHandle: FlowHandle = {}
    const screen = await renderWorkflowBrowserComponent(
      <>
        <WorkflowCanvasFixture nodes={nodes} edges={[]} flowHandle={flowHandle} />
        <ViewWorkflowHistory />
      </>,
      {
        resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
        initialStoreState: { controlMode: ControlMode.Hand },
        historyStore: { nodes, edges: [] },
      },
    )
    const node = screen.getByRole('button', { name: 'Workflow node' })
    await node.click()
    await recordHistory(() => userEvent.keyboard('{Delete}'))
    await expect.element(node).not.toBeInTheDocument()
    await undo()
    await expect.element(node).toBeInTheDocument()

    await screen.getByRole('button', { name: 'workflowHistory.changeHistory.title' }).click()
    await screen.getByRole('button', { name: /workflow.changeHistory.nodeDelete/ }).click()
    await expect.element(node).not.toBeInTheDocument()
    expect(flowHandle.current!.getState().getNodes()).toEqual([])
    expect(flowHandle.current!.getState().edges).toEqual([])
  })
})

beforeEach(() => {
  onTestFinished(guardUnexpectedFetch())
})
