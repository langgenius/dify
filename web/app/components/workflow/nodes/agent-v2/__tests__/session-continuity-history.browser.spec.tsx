import type { Node, WorkflowDataUpdater } from '@/app/components/workflow/types'
import { useStoreApi } from 'reactflow'
import { WORKFLOW_DATA_UPDATE } from '@/app/components/workflow/constants'
import DatasetsDetailProvider from '@/app/components/workflow/datasets-detail-store/provider'
import HeaderInNormal from '@/app/components/workflow/header/header-in-normal'
import UndoRedo from '@/app/components/workflow/header/undo-redo'
import { useNodesInteractions } from '@/app/components/workflow/hooks/use-nodes-interactions'
import { VersionHistoryPanel } from '@/app/components/workflow/panel/version-history-panel'
import { useStore } from '@/app/components/workflow/store'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { setupFakeApi } from '@/test/fake-api'
import { createWorkflowResponseFixture } from '@/test/fixtures/workflow-response'
import { createAgentNode, renderSessionContinuityPanel } from './session-continuity-test-env'

const fake = setupFakeApi({
  console: {
    apps: {
      byAppId: {
        trace: { get: () => ({ enabled: false }) },
        workflows: {
          draft: {
            post: ({ body }) => ({
              hash: `${body.hash}-saved`,
              result: 'success',
              updated_at: 1,
            }),
          },
        },
      },
    },
  },
})

const saveDraft = () => fake.console.apps.byAppId.workflows.draft.post

function HistoryControls() {
  const { handleHistoryBack, handleHistoryForward } = useNodesInteractions()
  return <UndoRedo handleUndo={handleHistoryBack} handleRedo={handleHistoryForward} />
}

function VersionHistoryControls({ nodes }: { nodes: Node[] }) {
  const showVersionHistory = useStore((state) => state.showWorkflowVersionHistoryPanel)
  const { eventEmitter } = useEventEmitterContextContext()
  const flow = useStoreApi()
  // The fixture's ReactFlow canvas receives the same graph updates as the editor canvas.
  eventEmitter?.useSubscription((event) => {
    if (typeof event === 'object' && event.type === WORKFLOW_DATA_UPDATE) {
      const { nodes, edges } = event.payload as WorkflowDataUpdater
      flow.getState().setNodes(nodes)
      flow.getState().setEdges(edges)
    }
  })

  return showVersionHistory ? (
    <div className="h-48">
      <VersionHistoryPanel />
    </div>
  ) : (
    <DatasetsDetailProvider nodes={nodes}>
      <HeaderInNormal components={{ title: 'Chatflow' }} />
    </DatasetsDetailProvider>
  )
}

it('shows the published session setting during version preview and restores the draft setting after closing', async () => {
  const published = createWorkflowResponseFixture({
    version: '2026-06-01T00:00:00Z',
    marked_name: 'First release',
    graph: {
      nodes: [createAgentNode('Agent A', { continue_agent_session: false })],
      edges: [],
    },
  })
  fake.use({
    console: {
      workspaces: { current: { agentProviders: { get: () => [] } } },
      apps: {
        byAppId: {
          workflows: {
            get: () => ({ items: [published], page: 1, limit: 10, has_more: false }),
          },
        },
      },
    },
  })
  const nodes = [createAgentNode('Agent A')]
  const screen = await renderSessionContinuityPanel({
    nodes,
    controls: <VersionHistoryControls nodes={nodes} />,
  })
  const { sessionSwitch } = screen
  await expect.element(sessionSwitch).toBeChecked()

  await screen.getByRole('button', { name: 'workflow.common.versionHistory' }).click()
  const release = screen.getByRole('button', { name: 'First release' })
  await release.click()
  await expect.element(release).toHaveAttribute('aria-current', 'true')
  await expect.element(sessionSwitch).toBeDisabled()
  await expect.element(sessionSwitch).not.toBeChecked()

  await screen.getByRole('button', { name: 'common.operation.close' }).click()
  await expect.element(sessionSwitch).toBeChecked()
  await expect.element(sessionSwitch).toBeEnabled()
  expect(saveDraft()).not.toHaveBeenCalled()
})

it('includes the undone session setting in the pending draft save', async () => {
  const screen = await renderSessionContinuityPanel({ controls: <HistoryControls /> })
  const { sessionSwitch } = screen
  const undo = screen.getByRole('button', { name: 'workflow.common.undo' })
  const redo = screen.getByRole('button', { name: 'workflow.common.redo' })

  await sessionSwitch.click()
  await expect.element(sessionSwitch).not.toBeChecked()
  await expect.element(undo).toBeEnabled()
  await undo.click()
  await expect.element(sessionSwitch).toBeChecked()
  screen.store.getState().flushPendingSync()
  await expect
    .poll(() => saveDraft().mock.lastCall?.[0].body.graph.nodes)
    .toMatchObject([{ id: 'Agent A', data: { continue_agent_session: true } }])

  await redo.click()
  await expect.element(sessionSwitch).not.toBeChecked()
  expect(saveDraft()).toHaveBeenCalledTimes(1)
})

it('applies the session setting when jumping through Change History', async () => {
  const screen = await renderSessionContinuityPanel({ controls: <HistoryControls /> })
  await screen.sessionSwitch.click()
  await expect.element(screen.sessionSwitch).toBeEnabled()
  await expect.element(screen.getByRole('button', { name: 'workflow.common.undo' })).toBeEnabled()

  await screen.getByRole('button', { name: 'workflowHistory.changeHistory.title' }).click()
  await screen.getByRole('button', { name: /workflowHistory\.changeHistory\.sessionStart/ }).click()

  await expect.element(screen.sessionSwitch).toBeChecked()
})
