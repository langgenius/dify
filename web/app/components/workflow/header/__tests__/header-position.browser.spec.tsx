import { Button } from '@langgenius/dify-ui/button'
import ReactFlow, { ReactFlowProvider } from 'reactflow'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { WorkflowContext } from '../../context'
import { HooksStoreContext } from '../../hooks-store/provider'
import { createHooksStore } from '../../hooks-store/store'
import { createWorkflowStore } from '../../store/workflow'
import Header from '../index'
import 'reactflow/dist/style.css'

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  const { default: workflow } = await import('@/i18n/en-US/workflow.json')
  return createReactI18nextMock(workflow)
})

vi.mock('../../hooks/use-workflow', () => ({
  useNodesReadOnly: () => ({ nodesReadOnly: false }),
}))

vi.mock('../../hooks/use-nodes-interactions', () => ({
  useNodesInteractions: () => ({ handleNodeSelect: vi.fn() }),
}))

vi.mock('../../hooks/use-workflow-run', () => ({
  useWorkflowRun: () => ({ handleBackupDraft: vi.fn() }),
}))

vi.mock('../../utils/node-navigation', () => ({
  scrollToWorkflowNode: vi.fn(),
}))

vi.mock('@/app/components/rag-pipeline/hooks/use-input-field-panel', () => ({
  useInputFieldPanel: () => ({ closeAllInputFieldPanels: vi.fn() }),
}))

vi.mock('@/hooks/use-theme', () => ({ default: () => ({ theme: 'light' }) }))

vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({
    formatTime: (timestamp: number) => new Date(timestamp * 1000).toISOString().slice(11, 19),
  }),
}))

vi.mock('@/hooks/use-format-time-from-now', () => ({
  useFormatTimeFromNow: () => ({ formatTimeFromNow: () => '42 minutes ago' }),
}))

// These independently tested features do not own the header's column layout.
vi.mock('../online-users', () => ({ default: () => null }))
vi.mock('../run-and-history', () => ({
  default: () => <div className="h-8 w-50">Run controls</div>,
}))

describe('Workflow header positioning', () => {
  // Browser-owned: text reflow and the resulting positions of neighboring controls.
  it.each([
    { width: 1648, builderOpen: false },
    { width: 774, builderOpen: true },
  ])(
    'keeps navigation still when save status changes at $width px',
    async ({ width, builderOpen }) => {
      await page.viewport(1800, 800)
      const store = createWorkflowStore({})
      store.setState({
        draftUpdatedAt: Date.UTC(2026, 8, 11, 3, 1, 12),
        publishedAt: 0,
        showDifyBuilderPanel: builderOpen,
      })
      const hooksStore = createHooksStore({})
      const screen = await render(
        <WorkflowContext value={store}>
          <HooksStoreContext value={hooksStore}>
            <section aria-label="Workflow canvas" className="relative h-100" style={{ width }}>
              <ReactFlowProvider>
                <ReactFlow
                  nodes={[
                    { id: 'selected-node', position: { x: 0, y: 100 }, data: { selected: true } },
                  ]}
                >
                  <Header
                    normal={{
                      components: { middle: <Button>Publish</Button> },
                      controls: { showDifyBuilderButton: true },
                    }}
                  />
                </ReactFlow>
              </ReactFlowProvider>
            </section>
          </HooksStoreContext>
        </WorkflowContext>,
      )
      const navigation = screen.getByRole('button', { name: 'Scroll to selected node' })
      const initial = navigation.element().getBoundingClientRect()
      const canvas = screen
        .getByRole('region', { name: 'Workflow canvas' })
        .element()
        .getBoundingClientRect()
      const status = screen.getByRole('status', { name: 'Workflow save status' })

      store.getState().setPublishedAt(Date.UTC(2026, 8, 11, 2, 19, 12) / 1000)
      store.getState().setIsSyncingWorkflowDraft(true)
      await expect.element(status).toHaveTextContent('Syncing data')
      const statusText = document.createRange()
      statusText.selectNodeContents(status.element())
      expect(navigation.element().getBoundingClientRect().x).toBe(initial.x)
      expect(navigation.element().getBoundingClientRect().y).toBe(initial.y)
      expect(statusText.getBoundingClientRect().right).toBeLessThanOrEqual(initial.left)
      expect(statusText.getBoundingClientRect().top).toBeGreaterThanOrEqual(canvas.top)

      store.getState().setDraftUpdatedAt(Date.UTC(2026, 8, 11, 3, 2, 58) / 1000)
      store.getState().setIsSyncingWorkflowDraft(false)
      await expect.element(status).toHaveTextContent('03:02:58')
      expect(navigation.element().getBoundingClientRect().x).toBe(initial.x)
      expect(navigation.element().getBoundingClientRect().y).toBe(initial.y)

      const runControls = screen.getByText('Run controls').element().getBoundingClientRect()
      const builder = screen.getByRole('button', { name: /app builder/i })
      expect(status.element().getBoundingClientRect().right).toBeLessThanOrEqual(initial.left)
      expect(initial.right).toBeLessThanOrEqual(runControls.left)
      expect(builder.element().getBoundingClientRect().right).toBeLessThanOrEqual(canvas.right)
      await navigation.click()
      await builder.click()
      await expect.element(builder).toHaveAttribute('aria-expanded', String(!builderOpen))
    },
  )
})
