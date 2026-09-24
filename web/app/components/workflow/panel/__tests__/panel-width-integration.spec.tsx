import type { ReactNode } from 'react'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { ReactFlowProvider, useStoreApi } from 'reactflow'
import SnippetRunPanel from '@/app/components/snippets/components/snippet-run-panel'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import DebugAndPreview from '../debug-and-preview'
import Panel from '../index'
import WorkflowPreview from '../workflow-preview'

vi.mock('@/app/components/workflow/hooks/use-workflow-panel-interactions', () => ({
  useWorkflowInteractions: () => ({ handleCancelDebugAndPreviewPanel: vi.fn() }),
}))
vi.mock('@/app/components/workflow/hooks/use-workflow-run', () => ({
  useWorkflowRun: () => ({ handleRun: vi.fn() }),
}))
vi.mock('@/app/components/workflow/hooks/use-nodes-interactions-without-sync', () => ({
  useNodesInteractionsWithoutSync: () => ({ handleNodeCancelRunningStatus: vi.fn() }),
}))
vi.mock('@/app/components/workflow/hooks/use-edges-interactions-without-sync', () => ({
  useEdgesInteractionsWithoutSync: () => ({ handleEdgeCancelRunningStatus: vi.fn() }),
}))
vi.mock('@/app/components/base/chat/chat/check-input-forms-hooks', () => ({
  useCheckInputsForms: () => ({ checkInputsForm: vi.fn() }),
}))
vi.mock('@/app/components/workflow/panel/debug-and-preview/chat-wrapper', () => ({
  default: () => null,
}))
vi.mock('@/app/components/workflow/run/tracing-panel', () => ({ default: () => null }))
vi.mock('@/app/components/workflow/run/result-panel', () => ({ default: () => null }))
vi.mock('@/app/components/workflow/run/result-text', () => ({ default: () => null }))
vi.mock('@/app/components/workflow/panel/inputs-panel', () => ({ default: () => null }))
vi.mock('@/app/components/workflow/panel/env-panel', () => ({ default: () => null }))
// Node details do not own the preview width limit. Node-panel compression is
// covered separately at the real BasePanel boundary.
vi.mock('@/app/components/workflow/nodes', () => ({
  Panel: () => <div>Selected node details</div>,
}))

function SelectedNodePanel({ children }: { children: ReactNode }) {
  const reactFlowStore = useStoreApi()
  useEffect(() => {
    reactFlowStore.getState().setNodes([createNode({ data: { selected: true } })])
  }, [reactFlowStore])
  return (
    <>
      <button
        type="button"
        onClick={() => {
          const { getNodes, setNodes } = reactFlowStore.getState()
          setNodes(getNodes().map((node) => ({ ...node, data: { ...node.data, selected: false } })))
        }}
      >
        Deselect node
      </button>
      <Panel components={{ right: children }} />
    </>
  )
}

function renderPanels(children: ReactNode) {
  return renderWorkflowComponent(
    <ReactFlowProvider>
      <SelectedNodePanel>{children}</SelectedNodePanel>
    </ReactFlowProvider>,
    {
      initialStoreState: { workflowCanvasWidth: 1400, nodePanelWidth: 600, previewPanelWidth: 400 },
    },
  )
}

describe('preview width limits inside the workflow Panel', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([
    ['workflow run', <WorkflowPreview key="workflow" />],
    ['snippet run', <SnippetRunPanel key="snippet" fields={[]} />],
    ['chat debug', <DebugAndPreview key="debug" />],
  ])(
    '%s exposes the reachable maximum and restores canvas space after deselection',
    async (_name, content) => {
      const user = userEvent.setup()
      renderPanels(content)
      const handle = screen.getByRole('separator')
      expect(handle).toHaveAttribute('aria-valuemax', '600')
      await user.tab()
      await user.tab()
      expect(handle).toHaveFocus()
      await user.keyboard('{End}{ArrowLeft}')
      expect(handle).toHaveAttribute('aria-valuenow', '600')
      const panel = document.getElementById(handle.getAttribute('aria-controls')!)!
      expect(panel).toHaveStyle({ width: '600px' })

      await user.click(screen.getByRole('button', { name: 'Deselect node' }))
      expect(screen.queryByText('Selected node details')).not.toBeInTheDocument()
      expect(handle).toHaveAttribute('aria-valuemax', '1000')
      await user.tab()
      await user.keyboard('{End}')
      expect(handle).toHaveAttribute('aria-valuenow', '1000')
      expect(panel).toHaveStyle({ width: '1000px' })
    },
  )

  it('allows the debug panel to grow by pointer while the selected node panel is wider than its minimum', async () => {
    const user = userEvent.setup()
    renderPanels(<DebugAndPreview />)
    const handle = screen.getByRole('separator')
    await user.pointer([
      { keys: '[MouseLeft>]', target: handle, coords: { clientX: 1000 } },
      { target: handle, coords: { clientX: 800 } },
      { keys: '[/MouseLeft]', target: handle },
    ])
    await waitFor(() => expect(handle).toHaveAttribute('aria-valuenow', '600'))
    expect(handle).toHaveAttribute('aria-valuemax', '600')
  })

  it.each([
    ['workflow run', <WorkflowPreview key="workflow" />],
    ['snippet run', <SnippetRunPanel key="snippet" fields={[]} />],
    ['chat debug', <DebugAndPreview key="debug" />],
  ])(
    '%s keeps its size and ARIA range consistent when the canvas shrinks without a selected node',
    async (_name, content) => {
      const user = userEvent.setup()
      const { store } = renderPanels(content)
      await user.click(screen.getByRole('button', { name: 'Deselect node' }))
      const handle = screen.getByRole('separator')
      await user.tab()
      expect(handle).toHaveFocus()
      await user.keyboard('{End}')
      expect(handle).toHaveAttribute('aria-valuenow', '1000')

      act(() => store.getState().setWorkflowCanvasWidth(1000))

      await waitFor(() => expect(handle).toHaveAttribute('aria-valuenow', '600'))
      expect(handle).toHaveAttribute('aria-valuemax', '600')
      const panel = document.getElementById(handle.getAttribute('aria-controls')!)!
      expect(panel).toHaveStyle({ width: '600px' })
      expect(handle).toHaveFocus()
      await user.keyboard('{ArrowLeft}')
      expect(handle).toHaveAttribute('aria-valuenow', '600')
      await user.keyboard('{ArrowRight}')
      expect(handle).toHaveAttribute('aria-valuenow', '592')
    },
  )
})
