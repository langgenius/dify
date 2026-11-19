import type { Edge, Node } from '../../types'
import type { FlowHandle } from './workflow-canvas-fixture'
import { detectPlatform } from '@tanstack/react-hotkeys'
import { page, userEvent } from 'vite-plus/test/browser'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createNode } from '../../__tests__/fixtures'
import { renderWorkflowBrowserComponent as render } from '../../__tests__/workflow-browser-test-env'
import { ControlMode } from '../../types'
import { WorkflowCanvasFixture } from './workflow-canvas-fixture'

export const initialNodes = [
  createNode({
    id: 'node',
    type: 'default',
    ariaLabel: 'Workflow node',
    position: { x: 350, y: 150 },
    data: { label: 'Workflow node' },
  }),
  // Keep a nonempty snapshot for redo; the known empty-canvas redo bug is outside this batch.
  createNode({
    id: 'anchor',
    type: 'default',
    ariaLabel: 'Anchor node',
    position: { x: 730, y: 430 },
    data: { label: 'Anchor node' },
  }),
]

export const mod = detectPlatform() === 'mac' ? 'Meta' : 'Control'
export const undo = () => userEvent.keyboard(`{${mod}>}z{/${mod}}`)
export const redo = () => userEvent.keyboard(`{${mod}>}{Shift>}z{/Shift}{/${mod}}`)

// Advance the production history debounce explicitly, without relying on CI wall-clock speed.
export async function recordHistory(action: () => Promise<unknown>) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  try {
    await action()
    await vi.advanceTimersByTimeAsync(600)
  } finally {
    vi.useRealTimers()
  }
}

type CanvasProps = {
  nodes?: Node[]
  edges?: Edge[]
  contextMenuType?: 'node' | 'edge' | 'selection'
}

export async function setupWorkflowCanvas(props: CanvasProps = {}, commentMode = false) {
  await page.viewport(1000, 700)
  const { queryClient } = createConsoleQueryWrapper({ appDslVersion: '0.6.0' })
  // Draft persistence is supplied by the owning editor; graph mutations and history stay real.
  const save = vi.fn(async () => undefined)
  const flowHandle: FlowHandle = {}
  const nodes = props.nodes ?? initialNodes
  const edges = props.edges ?? []
  const screen = await render(
    <>
      <button>Before canvas</button>
      <WorkflowCanvasFixture
        nodes={nodes}
        edges={edges}
        contextMenuType={props.contextMenuType}
        flowHandle={flowHandle}
      />
    </>,
    {
      queryClient,
      resource: {
        kind: 'app',
        appId: 'app-1',
        mode: 'workflow',
        collaborationEnabled: commentMode,
      },
      initialStoreState: { controlMode: ControlMode.Hand },
      hooksStoreProps: { doSyncWorkflowDraft: save },
      historyStore: { nodes, edges },
    },
  )
  const flow = flowHandle.current
  if (!flow) throw new Error('Workflow canvas store was not captured')

  return {
    ...screen,
    save,
    graphNodes: () => flow.getState().getNodes(),
    graphEdges: () => flow.getState().edges,
  }
}
