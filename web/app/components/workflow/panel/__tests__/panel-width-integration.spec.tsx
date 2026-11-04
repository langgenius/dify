import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStartNode } from '@/app/components/workflow/__tests__/fixtures'
import DatasetsDetailProvider from '@/app/components/workflow/datasets-detail-store/provider'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { createNuqsTestRenderer } from '@/test/nuqs-testing'
import { renderWorkflowEditor } from '@/test/workflow-editor'
import Panel from '../index'
import WorkflowPreview from '../workflow-preview'

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'appDslVersion.get': async () => ({ app_dsl_version: '0.6.0' }),
      'workspaces.current.agentProviders.get': async () => [],
      'apps.byAppId.workflows.draft.environmentVariables.get': async () => ({ items: [] }),
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.triggers.get': async () => [],
      'apps.byAppId.workflows.draft.variables.get': async () => ({ items: [], total: 0 }),
    }),
  }
})

const render = createNuqsTestRenderer(renderWorkflowEditor)

it('reserves room for the selected node, releases it when closed, and clamps the preview when the canvas shrinks', async () => {
  const user = userEvent.setup()
  const nodes = [createStartNode({ data: { selected: true, title: 'User input', variables: [] } })]
  const { store } = render(
    <EventEmitterContextProvider>
      <DatasetsDetailProvider nodes={nodes}>
        <Panel components={{ right: <WorkflowPreview /> }} />
      </DatasetsDetailProvider>
    </EventEmitterContextProvider>,
    {
      nodes,
      historyStore: { nodes, edges: [] },
      initialStoreState: { workflowCanvasWidth: 1400, nodePanelWidth: 600, previewPanelWidth: 400 },
    },
  )
  const nodePanel = await screen.findByRole('region', {
    name: 'User input workflow.panel.nodePanel',
  })
  const preview = screen.getByRole('separator', { name: 'workflow.singleRun.testRun' })
  expect(preview).toHaveAttribute('aria-valuemax', '600')
  preview.focus()
  await user.keyboard('{End}')
  expect(preview).toHaveAttribute('aria-valuenow', '600')
  await user.click(within(nodePanel).getByRole('button', { name: 'common.operation.close' }))
  await waitFor(() => expect(nodePanel).not.toBeInTheDocument())
  expect(preview).toHaveAttribute('aria-valuemax', '1000')
  preview.focus()
  await user.keyboard('{End}')
  expect(preview).toHaveAttribute('aria-valuenow', '1000')
  act(() => store.getState().setWorkflowCanvasWidth(1000))
  await waitFor(() => expect(preview).toHaveAttribute('aria-valuenow', '600'))
  expect(preview).toHaveAttribute('aria-valuemax', '600')
  expect(preview).toHaveFocus()
  await user.keyboard('{ArrowRight}')
  expect(preview).toHaveAttribute('aria-valuenow', '592')
})
