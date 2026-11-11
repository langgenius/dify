import type { ComponentType } from 'react'
import type { NodeProps } from 'reactflow'
import type { ExternalAgentWorkflowPreviewNodeData } from '../types'
import type { CommonNodeType } from '@/app/components/workflow/types'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import ReactFlow, { Handle, Position, ReactFlowProvider, useNodes } from 'reactflow'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createEdge, createNode } from '@/app/components/workflow/__tests__/fixtures'
import { WorkflowContext } from '@/app/components/workflow/context'
import { EditorResourceScope } from '@/app/components/workflow/editor-resource/provider'
import { HooksStoreContext } from '@/app/components/workflow/hooks-store/provider'
import { createHooksStore } from '@/app/components/workflow/hooks-store/store'
import { NodeComponentMap } from '@/app/components/workflow/nodes/components'
import Panel from '@/app/components/workflow/nodes/panel'
import { createWorkflowStore } from '@/app/components/workflow/store/workflow'
import { BlockEnum, InputVarType, VarType } from '@/app/components/workflow/types'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { createExternalRosterPreview } from '@/features/agent-v2/roster/external-roster-preview'
import agentRoster from '@/i18n/locales/en-US/agent-roster.json'
import common from '@/i18n/locales/en-US/common.json'
import workflowAgent from '@/i18n/locales/en-US/workflow-agent.json'
import workflowDebug from '@/i18n/locales/en-US/workflow-debug.json'
import workflow from '@/i18n/locales/en-US/workflow.json'
import { consoleQuery } from '@/service/console'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { createExternalAgentWorkflowPreviewData } from '../preview'
import { isExternalAgentWorkflowPreviewData } from '../types'
import 'reactflow/dist/style.css'

vi.mock('react-i18next', async (importOriginal) => importOriginal())

// The Agent catalog entry routes external preview data before mounting Dify API owners.
const AgentNode = NodeComponentMap[BlockEnum.Agent] as unknown as ComponentType<{
  id: string
  data: ExternalAgentWorkflowPreviewNodeData
}>

function CanvasNode({ id, data }: NodeProps<CommonNodeType>) {
  return (
    <>
      <Handle type="target" position={Position.Left} />
      {isExternalAgentWorkflowPreviewData(data) ? (
        <AgentNode id={id} data={data} />
      ) : (
        <div>{data.title}</div>
      )}
      <Handle type="source" position={Position.Right} />
    </>
  )
}

const nodeTypes = { custom: CanvasNode }

function SelectedPanel() {
  const node = useNodes<CommonNodeType>().find((node) => node.selected || node.data.selected)
  return node ? <Panel type={node.type} id={node.id} data={node.data} /> : null
}

async function setup() {
  await page.viewport(1280, 1000)
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    resources: { 'en-US': { agentRoster, common, workflowAgent, workflowDebug, workflow } },
    keySeparator: false,
    interpolation: { escapeValue: false },
  })
  const { queryClient, wrapper: QueryProvider } = createConsoleQueryWrapper({
    currentWorkspace: { role: 'owner' },
  })
  onTestFinished(() => queryClient.clear())
  seedModelProviderQueries(queryClient)
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])
  const syncDraft = vi.fn(async () => {})
  const hooks = createHooksStore({ doSyncWorkflowDraft: syncDraft })
  const store = createWorkflowStore({})
  const agent = createExternalRosterPreview()[1]!
  const data: ExternalAgentWorkflowPreviewNodeData = {
    type: BlockEnum.Agent,
    title: 'Agent',
    desc: '',
    selected: true,
    ...createExternalAgentWorkflowPreviewData(agent),
  }
  const nodes = [
    createNode({
      id: 'input',
      position: { x: 0, y: 0 },
      data: {
        type: BlockEnum.Start,
        title: 'Input',
        variables: [
          {
            variable: 'contract_text',
            type: InputVarType.paragraph,
            label: 'Contract text',
            required: false,
          },
        ],
      },
    }),
    createNode({
      id: 'policy',
      position: { x: 0, y: 100 },
      data: {
        type: BlockEnum.Code,
        title: 'Policy',
        outputs: { result: { type: VarType.string } },
      },
    }),
    createNode({ id: 'external-agent', position: { x: 160, y: 50 }, selected: true, data }),
  ]
  const edges = [
    createEdge({ source: 'input', target: 'policy' }),
    createEdge({ source: 'policy', target: 'external-agent' }),
  ]
  await render(
    <QueryProvider>
      <EditorResourceScope
        resource={{
          kind: 'app',
          appId: 'external-preview-app',
          mode: 'workflow',
          collaborationEnabled: false,
        }}
      >
        <WorkflowContext value={store}>
          <HooksStoreContext value={hooks}>
            <EventEmitterContextProvider>
              <I18nextProvider i18n={i18n}>
                <ReactFlowProvider>
                  <div className="isolate flex gap-4" style={{ height: 960 }}>
                    <section aria-label="Agent canvas" style={{ width: 480, height: 960 }}>
                      <ReactFlow
                        defaultNodes={nodes}
                        defaultEdges={edges}
                        nodeTypes={nodeTypes}
                        fitView
                      />
                    </section>
                    <SelectedPanel />
                  </div>
                </ReactFlowProvider>
              </I18nextProvider>
            </EventEmitterContextProvider>
          </HooksStoreContext>
        </WorkflowContext>
      </EditorResourceScope>
    </QueryProvider>,
  )
  onTestFinished(() => {
    expect(syncDraft).not.toHaveBeenCalled()
  })
  const panel = page.getByRole('region', { name: 'Contract Review Agent', exact: true })
  await expect.element(panel).toBeVisible()
  return { panel, canvas: page.getByRole('region', { name: 'Agent canvas', exact: true }) }
}

async function closeAndReopen(
  panel: ReturnType<typeof page.getByRole>,
  name = 'Contract Review Agent',
) {
  await panel.getByRole('button', { name: 'Close', exact: true }).click()
  await expect.element(panel).not.toBeInTheDocument()
  await page
    .getByRole('region', { name: 'Agent canvas', exact: true })
    .getByText(name, { exact: true })
    .click()
  const reopened = page.getByRole('region', { name, exact: true })
  await expect.element(reopened).toBeVisible()
  return reopened
}

async function replaceTask(task: ReturnType<typeof page.getByRole>, value: string) {
  await task.click()
  await userEvent.keyboard(
    /Mac/.test(navigator.userAgent) ? '{Meta>}a{/Meta}' : '{Control>}a{/Control}',
  )
  await userEvent.keyboard('{Backspace}')
  await expect.element(task).toHaveTextContent('')
  await task.fill(value)
}

beforeEach(({ onTestFinished }) => {
  onTestFinished(guardUnexpectedFetch())
})

it('shows the external badge and updates the canvas agent through the change picker without Dify APIs', async () => {
  const { panel, canvas } = await setup()
  await expect.element(panel.getByText('External', { exact: true })).toBeVisible()
  await expect.element(canvas.getByText('External', { exact: true })).toBeVisible()
  await expect
    .element(panel.getByRole('tab', { name: 'Settings', exact: true }))
    .toHaveAttribute('aria-selected', 'true')
  await expect
    .element(panel.getByRole('button', { name: /Run this step/i }))
    .toHaveAttribute('aria-disabled', 'true')
  await panel.getByRole('button', { name: 'Change', exact: true }).click()
  await page.getByRole('button', { name: /Document Review Agent/ }).click()
  const changedPanel = page.getByRole('region', { name: 'Document Review Agent', exact: true })
  await expect.element(changedPanel).toBeVisible()
  await expect.element(canvas.getByText('Document Review Agent', { exact: true })).toBeVisible()
  await expect
    .element(canvas.getByText('Contract Review Agent', { exact: true }))
    .not.toBeInTheDocument()
  await closeAndReopen(changedPanel, 'Document Review Agent')
})

it('keeps edits made in the real task editor when closing and reopening the node', async () => {
  const { panel } = await setup()
  const task = panel.getByRole('textbox', { name: 'Agent task', exact: true })
  await expect.element(task).toMatchTextContent(/Policy/)
  await expect.element(task).toMatchTextContent(/Contract/)
  await replaceTask(task, 'Review the renewal terms and highlight unusual liability clauses.')
  await userEvent.tab()
  const reopened = await closeAndReopen(panel)
  await expect
    .element(reopened.getByRole('textbox', { name: 'Agent task', exact: true }))
    .toHaveTextContent('Review the renewal terms and highlight unusual liability clauses.')
})

it('retains the wait limit and error strategy through panel reopening', async () => {
  const { panel } = await setup()
  const enabled = panel.getByRole('switch', { name: 'External agent wait limit', exact: true })
  const minutes = panel.getByRole('textbox', { name: 'Wait limit', exact: true })
  await expect.element(enabled).toBeChecked()
  await expect.element(minutes).toHaveValue('10')
  await minutes.fill('25')
  await userEvent.tab()
  await expect
    .element(panel.getByRole('slider', { name: 'Wait limit', exact: true }))
    .toHaveAttribute('aria-valuenow', '25')
  await enabled.click()
  await expect.element(enabled).not.toBeChecked()
  await enabled.click()
  await expect.element(minutes).toHaveValue('25')
  const errorHandling = panel.getByRole('button', { name: 'Fail Branch', exact: true })
  await expect.element(errorHandling).toBeVisible()
  await errorHandling.click()
  await page.getByRole('menuitemradio', { name: /^None/ }).click()
  const reopened = await closeAndReopen(panel)
  await expect
    .element(reopened.getByRole('textbox', { name: 'Wait limit', exact: true }))
    .toHaveValue('25')
  await expect.element(reopened.getByRole('button', { name: 'None', exact: true })).toBeVisible()
  await expect
    .element(reopened.getByRole('combobox', { name: 'On timeout', exact: true }))
    .toMatchTextContent('End waiting')
})

it('creates an output token from the task editor and retains its output definition', async () => {
  const { panel } = await setup()
  await replaceTask(panel.getByRole('textbox', { name: 'Agent task', exact: true }), 'Return ')
  await userEvent.keyboard('/')
  await page
    .getByRole('listbox', { name: 'Typeahead menu', exact: true })
    .getByRole('button', { name: 'New output', exact: true })
    .click()
  const name = page.getByRole('textbox', { name: 'Field name', exact: true })
  await expect.element(name).toHaveFocus()
  await name.fill('review_notes')
  await userEvent.keyboard('{Enter}')
  await expect.element(name).not.toBeInTheDocument()
  await expect
    .element(panel.getByRole('textbox', { name: 'Agent task', exact: true }))
    .toMatchTextContent(/review_notes/)
  const reopened = await closeAndReopen(panel)
  await expect
    .element(reopened.getByRole('textbox', { name: 'Agent task', exact: true }))
    .toMatchTextContent(/review_notes/)
  await expect
    .element(reopened.getByRole('button', { name: 'Delete review_notes', exact: true }))
    .toBeInTheDocument()
})

it('allows the default text output to be edited and deleted while retaining a newly added output', async () => {
  const { panel } = await setup()
  await expect.element(panel.getByText('Text returned by the agent', { exact: true })).toBeVisible()
  await panel.getByText('text', { exact: true }).last().hover()
  await panel.getByRole('button', { name: 'Edit text', exact: true }).click()
  await panel
    .getByRole('form', { name: 'Output variable editor', exact: true })
    .getByRole('textbox', { name: 'Description', exact: true })
    .fill('Contract review result')
  await panel.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect.element(panel.getByText('Contract review result', { exact: true })).toBeVisible()
  await panel.getByText('text', { exact: true }).last().hover()
  await panel.getByRole('button', { name: 'Edit text', exact: true }).click()
  const name = panel.getByRole('textbox', { name: 'Field name', exact: true })
  await name.fill('summary')
  await panel.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect.element(panel.getByText('summary', { exact: true })).toBeVisible()
  await panel.getByRole('button', { name: 'New output', exact: true }).click()
  await name.fill('review_notes')
  await panel.getByRole('button', { name: 'Confirm', exact: true }).click()
  await panel.getByText('summary', { exact: true }).hover()
  await panel.getByRole('button', { name: 'Delete summary', exact: true }).click()
  await expect.element(panel.getByText('summary', { exact: true })).not.toBeInTheDocument()
  const reopened = await closeAndReopen(panel)
  await expect.element(reopened.getByText('review_notes', { exact: true })).toBeVisible()
  await expect.element(reopened.getByText('text', { exact: true })).not.toBeInTheDocument()
})

it('shows the empty Last Run tab without requesting an execution record', async () => {
  const { panel } = await setup()
  await panel.getByRole('tab', { name: 'Last Run', exact: true }).click()
  await expect
    .element(panel.getByText('The results of the last run will be displayed here', { exact: true }))
    .toBeVisible()
  await panel.getByRole('tab', { name: 'Settings', exact: true }).click()
  await expect
    .element(panel.getByRole('textbox', { name: 'Agent task', exact: true }))
    .toBeVisible()
})
